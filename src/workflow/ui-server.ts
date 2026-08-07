import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import type { FlatGraph } from "@openworkflowspec/sdk";

import { buildWorkflowCatalog, type WorkflowCatalogEntry } from "./catalog.js";
import { compileWorkflow } from "./compiler.js";
import { expandWorkflowPrerequisites } from "./expanded-graph.js";
import { resolveHarnessLayout, type HarnessLayout } from "./paths.js";
import { loadWorkflowExecutionReport, loadWorkflowExecutionReports } from "./report.js";

export type WorkflowUiServerOptions = {
  rootDir: string;
  port?: number;
  host?: string;
  webRoot?: string;
};

type UiFile = { path: string; label: string; kind: "workflow" | "skill" | "check" | "model"; content: string };
type UiStep = { id: string; nodeId: string; kind: "skill" | "switch"; call?: string; checks: string[]; workflowName?: string };
type UiGraph = {
  id: string;
  type: string;
  nodes: { id: string; type: string; label?: string }[];
  edges: { id: string; sourceId: string; targetId: string; label?: string }[];
};
type UiWorkflow = {
  catalog: WorkflowCatalogEntry;
  entry: boolean;
  definition: unknown;
  graph: UiGraph | null;
  expandedGraph: UiGraph | null;
  diagnostics: readonly { code: string; message: string }[];
  steps: UiStep[];
  expandedSteps: UiStep[];
  files: UiFile[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getChecks(task: unknown): string[] {
  const metadata = asRecord(asRecord(task)?.metadata);
  const harness = asRecord(metadata?.harness);
  return Array.isArray(harness?.checks) ? harness.checks.filter((check): check is string => typeof check === "string") : [];
}

function getTaskEntries(definition: unknown): [string, unknown][] {
  const tasks = asRecord(definition)?.do;
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((item) => {
    const entry = Object.entries(asRecord(item) ?? {})[0];
    return entry === undefined ? [] : [entry];
  });
}

function projectGraph(graph: FlatGraph | null): UiGraph | null {
  if (graph === null) return null;
  return {
    id: graph.id,
    type: graph.type,
    nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type, ...(node.label === undefined ? {} : { label: node.label }) })),
    edges: graph.edges.map((edge) => ({ id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId, ...(edge.label === undefined ? {} : { label: edge.label }) })),
  };
}

function relativeFilePath(layout: HarnessLayout, absolutePath: string): string {
  return relative(layout.harnessRoot, absolutePath).split("\\").join("/");
}

function safeAbsolutePath(layout: HarnessLayout, absolutePath: string): string {
  const roots = [layout.harnessRoot, layout.workflowsRoot, layout.skillsRoot, layout.checksRoot, layout.modelsRoot];
  if (!roots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${sep}`))) throw new Error("文件路径必须位于 Harness Root 内。");
  return absolutePath;
}

function safePath(layout: HarnessLayout, requestedPath: string): string {
  return safeAbsolutePath(layout, resolve(layout.harnessRoot, requestedPath));
}

async function addFile(files: Map<string, UiFile>, layout: HarnessLayout, absolutePath: string, kind: UiFile["kind"], label: string): Promise<void> {
  const path = relativeFilePath(layout, safeAbsolutePath(layout, resolve(absolutePath)));
  if (files.has(path)) return;
  files.set(path, { path, label, kind, content: await readFile(safePath(layout, path), "utf8") });
}

async function readEntryWorkflows(layout: HarnessLayout, fallback: readonly string[]): Promise<string[]> {
  try {
    const catalog = asRecord(JSON.parse(await readFile(layout.catalogPath, "utf8")));
    return Array.isArray(catalog?.entryWorkflows) ? catalog.entryWorkflows.filter((name): name is string => typeof name === "string") : [...fallback];
  } catch {
    return [...fallback];
  }
}

async function addWorkflowFiles(
  layout: HarnessLayout,
  catalogEntry: WorkflowCatalogEntry,
  files: Map<string, UiFile>,
): Promise<unknown> {
  const workflowPath = safePath(layout, catalogEntry.path);
  const definition = load(await readFile(workflowPath, "utf8"));
  await addFile(files, layout, workflowPath, "workflow", `${catalogEntry.name} · workflow.yaml`);
  const steps = getTaskEntries(definition);
  for (const [, task] of steps) {
    const call = asRecord(task)?.call;
    if (typeof call === "string") {
      await addFile(files, layout, join(layout.skillsRoot, call, "SKILL.md"), "skill", call);
    }
    for (const check of getChecks(task)) {
      await addFile(files, layout, join(layout.checksRoot, check, "CHECK.md"), "check", check);
    }
  }
  const document = asRecord(definition);
  for (const target of ["input", "output"] as const) {
    const resource = asRecord(asRecord(asRecord(document?.[target])?.schema)?.resource);
    const endpoint = resource?.endpoint;
    if (typeof endpoint === "string" && endpoint.startsWith("harness://models/")) {
      const modelPath = endpoint.slice("harness://models/".length);
      await addFile(files, layout, join(layout.modelsRoot, modelPath), "model", `${target} · models/${modelPath}`);
    }
  }
  return definition;
}

async function buildWorkflowDetail(layout: HarnessLayout, catalogEntry: WorkflowCatalogEntry, entry: boolean): Promise<UiWorkflow> {
  const workflowPath = safePath(layout, catalogEntry.path);
  const files = new Map<string, UiFile>();
  const definition = await addWorkflowFiles(layout, catalogEntry, files);
  const compiled = await compileWorkflow({ rootDir: layout.harnessRoot, workflowPath });
  const steps = getTaskEntries(definition).map(([id, task], index) => {
    const call = typeof asRecord(task)?.call === "string" ? asRecord(task)?.call as string : undefined;
    return { id, nodeId: `/do/${String(index)}/${id}`, kind: call === undefined ? "switch" : "skill", ...(call === undefined ? {} : { call }), checks: getChecks(task), workflowName: catalogEntry.name } satisfies UiStep;
  });

  const expanded = catalogEntry.prerequisites.length === 0
    ? null
    : await expandWorkflowPrerequisites({ rootDir: layout.harnessRoot, workflowPath });
  if (expanded !== null) {
    for (const workflow of expanded.workflows) {
      await addWorkflowFiles(layout, workflow, files);
    }
  }
  const expandedSteps = expanded === null
    ? []
    : expanded.nodeMetadata.flatMap((metadata) => metadata.stepId === undefined
      ? []
      : [{
          id: metadata.stepId,
          nodeId: metadata.nodeId,
          kind: metadata.kind === "switch" ? "switch" : "skill",
          ...(metadata.call === undefined ? {} : { call: metadata.call }),
          checks: metadata.checks,
          workflowName: metadata.workflowName,
        } satisfies UiStep]);

  return {
    catalog: catalogEntry,
    entry,
    definition,
    graph: projectGraph(compiled.graph),
    expandedGraph: expanded === null ? null : projectGraph(expanded.graph),
    diagnostics: compiled.diagnostics,
    steps,
    expandedSteps,
    files: [...files.values()],
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function mimeType(path: string): string {
  switch (extname(path)) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function staticFile(response: ServerResponse, webRoot: string, pathname: string): Promise<void> {
  const absolutePath = resolve(webRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (absolutePath !== webRoot && !absolutePath.startsWith(`${webRoot}${sep}`)) {
    json(response, 403, { error: "静态资源路径无效。" });
    return;
  }
  try {
    const content = await readFile(absolutePath);
    response.writeHead(200, { "content-type": mimeType(absolutePath), "cache-control": "no-store" });
    response.end(content);
  } catch {
    json(response, 404, { error: "页面资源不存在。" });
  }
}

function workflowNameFromPath(pathname: string): string | undefined {
  const prefix = "/api/workflows/";
  if (!pathname.startsWith(prefix)) return undefined;
  const value = pathname.slice(prefix.length);
  if (value.length === 0) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

function runIdFromPath(pathname: string): string | undefined {
  const prefix = "/api/runs/";
  if (!pathname.startsWith(prefix)) return undefined;
  const value = pathname.slice(prefix.length);
  if (value.length === 0 || value.includes("/")) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

export function createWorkflowUiServer(options: WorkflowUiServerOptions): Server {
  const layout = resolveHarnessLayout(resolve(options.rootDir));
  const moduleRoot = dirname(fileURLToPath(import.meta.url));
  const bundledWebRoot = resolve(moduleRoot, "../web");
  const sourceWebRoot = resolve(moduleRoot, "../../web");
  const webRoot = resolve(options.webRoot ?? (existsSync(bundledWebRoot) ? bundledWebRoot : sourceWebRoot));
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET") { json(response, 405, { error: "管理页面只支持 GET 请求。" }); return; }
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      const catalog = await buildWorkflowCatalog(layout.harnessRoot);
      const entries = await readEntryWorkflows(layout, catalog.entryWorkflows);
      if (requestUrl.pathname === "/api/health") { json(response, 200, { ok: true, rootDir: layout.workspaceRoot }); return; }
      if (requestUrl.pathname === "/api/workflows") {
        json(response, 200, { entryWorkflows: entries, workflows: catalog.workflows.map((workflow) => ({ ...workflow, entry: entries.includes(workflow.name) })) });
        return;
      }
      if (requestUrl.pathname === "/api/runs") {
        json(response, 200, { runs: await loadWorkflowExecutionReports(layout.harnessRoot) });
        return;
      }
      const runId = runIdFromPath(requestUrl.pathname);
      if (runId !== undefined) {
        try {
          json(response, 200, await loadWorkflowExecutionReport(layout.harnessRoot, runId));
        } catch {
          json(response, 404, { error: "Workflow Run 不存在。" });
        }
        return;
      }
      const workflowName = workflowNameFromPath(requestUrl.pathname);
      if (workflowName !== undefined) {
        const entry = catalog.workflows.find((workflow) => workflow.name === workflowName);
        if (entry === undefined) { json(response, 404, { error: "Workflow 不存在。" }); return; }
        json(response, 200, await buildWorkflowDetail(layout, entry, entries.includes(entry.name)));
        return;
      }
      await staticFile(response, webRoot, requestUrl.pathname);
    } catch (error: unknown) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}

export async function startWorkflowUiServer(options: WorkflowUiServerOptions): Promise<void> {
  const server = createWorkflowUiServer(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  await new Promise<void>((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolveStart(); });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  console.log(`Workflow 管理页面已启动：http://${host}:${String(actualPort)}`);
  await new Promise<void>((resolveClose) => server.once("close", resolveClose));
}

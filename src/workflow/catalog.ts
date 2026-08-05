import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { load } from "js-yaml";

import { compileWorkflow } from "./compiler.js";
import { resolveHarnessLayout } from "./paths.js";

export type WorkflowRouting = {
  aliases: string[];
  when: string[];
  notWhen: string[];
};

export type WorkflowCatalogEntry = {
  name: string;
  namespace: string;
  version: string;
  title: string;
  summary: string;
  path: string;
  sourceHash: string;
  routing: WorkflowRouting;
  prerequisites: string[];
};

export type WorkflowCatalog = {
  schemaVersion: 2;
  mode: "all" | "selected";
  entryWorkflows: string[];
  workflows: WorkflowCatalogEntry[];
};

export type SyncWorkflowCatalogOptions = {
  rootDir: string;
  check?: boolean;
};

export type SyncWorkflowCatalogResult = {
  catalog: WorkflowCatalog;
  changed: boolean;
};

export type ActivateWorkflowCatalogOptions = {
  rootDir: string;
  check?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringArray(value: unknown, field: string, workflowName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Workflow '${workflowName}' 的 ${field} 必须是字符串数组。`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Workflow '${workflowName}' 的 ${field} 必须是字符串数组。`);
    }
    return item;
  });
}

function stringList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${field} 必须是非空字符串数组。`);
  }
  return value.map((item) => item as string);
}

function sourceHash(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function portablePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split("\\").join("/");
}

async function findWorkflowPaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await findWorkflowPaths(path)));
    } else if (entry.isFile() && entry.name === "workflow.yaml") {
      paths.push(path);
    }
  }
  return paths;
}

function readRouting(document: unknown, workflowName: string): WorkflowRouting {
  const metadata = asRecord(asRecord(document)?.metadata);
  const harness = asRecord(metadata?.harness);
  const routing = asRecord(harness?.routing);
  return {
    aliases: stringArray(routing?.aliases, "routing.aliases", workflowName),
    when: stringArray(routing?.when, "routing.when", workflowName),
    notWhen: stringArray(routing?.notWhen, "routing.notWhen", workflowName),
  };
}

function readPrerequisites(document: unknown, workflowName: string): string[] {
  const metadata = asRecord(asRecord(document)?.metadata);
  const harness = asRecord(metadata?.harness);
  return stringArray(harness?.prerequisites, "prerequisites", workflowName);
}

function validatePrerequisites(workflows: readonly WorkflowCatalogEntry[]): void {
  const byName = new Map(workflows.map((workflow) => [workflow.name, workflow]));
  for (const workflow of workflows) {
    for (const prerequisite of workflow.prerequisites) {
      if (!byName.has(prerequisite)) {
        throw new Error(
          `Workflow '${workflow.name}' 引用了不存在的前置 Workflow：${prerequisite}`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (workflowName: string, path: string[]): void => {
    if (visiting.has(workflowName)) {
      const cycleStart = path.indexOf(workflowName);
      const cycle = [...path.slice(cycleStart), workflowName].join(" -> ");
      throw new Error(`Workflow 前置依赖存在循环：${cycle}`);
    }
    if (visited.has(workflowName)) {
      return;
    }
    const workflow = byName.get(workflowName);
    if (workflow === undefined) {
      return;
    }
    visiting.add(workflowName);
    for (const prerequisite of workflow.prerequisites) {
      visit(prerequisite, [...path, workflowName]);
    }
    visiting.delete(workflowName);
    visited.add(workflowName);
  };
  for (const workflow of workflows) {
    visit(workflow.name, []);
  }
}

export async function buildWorkflowCatalog(rootDir: string): Promise<WorkflowCatalog> {
  const resolvedRoot = resolve(rootDir);
  const workflowsRoot = resolveHarnessLayout(resolvedRoot).workflowsRoot;
  const workflowPaths = await findWorkflowPaths(workflowsRoot);
  const workflows: WorkflowCatalogEntry[] = [];

  for (const workflowPath of workflowPaths) {
    const result = await compileWorkflow({ rootDir: resolvedRoot, workflowPath });
    if (!result.ok || result.workflow === null) {
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("；");
      throw new Error(`Workflow 编译失败：${portablePath(resolvedRoot, workflowPath)}：${messages}`);
    }

    const source = await readFile(workflowPath, "utf8");
    const { document } = result.workflow;
    workflows.push({
      name: document.name,
      namespace: document.namespace,
      version: document.version,
      title: document.title ?? document.name,
      summary: document.summary ?? "",
      path: portablePath(resolvedRoot, workflowPath),
      sourceHash: sourceHash(source),
      routing: readRouting(document, document.name),
      prerequisites: readPrerequisites(document, document.name),
    });
  }

  workflows.sort((left, right) => left.name.localeCompare(right.name));
  validatePrerequisites(workflows);
  const routeNames = new Map<string, string>();
  for (const workflow of workflows) {
    for (const routeName of [workflow.name, ...workflow.routing.aliases]) {
      const existing = routeNames.get(routeName);
      if (existing !== undefined) {
        throw new Error(`Workflow 路由名称或 Alias 重复：${routeName}`);
      }
      routeNames.set(routeName, workflow.name);
    }
  }

  return {
    schemaVersion: 2,
    mode: "all",
    entryWorkflows: workflows.map((workflow) => workflow.name),
    workflows,
  };
}

function resolveSelectedWorkflows(
  entryWorkflowPaths: readonly string[],
  catalog: WorkflowCatalog,
): WorkflowCatalog {
  const byPath = new Map(catalog.workflows.map((workflow) => [workflow.path, workflow]));
  const byName = new Map(catalog.workflows.map((workflow) => [workflow.name, workflow]));
  const entries = entryWorkflowPaths.map((path) => {
    const workflow = byPath.get(path);
    if (workflow === undefined) {
      throw new Error(`激活声明引用的 Workflow 不存在：${path}`);
    }
    return workflow;
  });
  if (new Set(entries.map((workflow) => workflow.name)).size !== entries.length) {
    throw new Error("激活声明不能重复引用同一个 Workflow。");
  }

  const selected = new Map<string, WorkflowCatalogEntry>();
  const collect = (workflow: WorkflowCatalogEntry): void => {
    if (selected.has(workflow.name)) {
      return;
    }
    selected.set(workflow.name, workflow);
    for (const prerequisiteName of workflow.prerequisites) {
      const prerequisite = byName.get(prerequisiteName);
      if (prerequisite === undefined) {
        throw new Error(
          `Workflow '${workflow.name}' 引用了不存在的前置 Workflow：${prerequisiteName}`,
        );
      }
      collect(prerequisite);
    }
  };
  for (const entry of entries) {
    collect(entry);
  }

  return {
    schemaVersion: 2,
    mode: "selected",
    entryWorkflows: entries.map((workflow) => workflow.name),
    workflows: [...selected.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

async function readActivationPaths(rootDir: string): Promise<string[]> {
  const layout = resolveHarnessLayout(rootDir);
  const source = await readFile(layout.activationPath, "utf8");
  const document = asRecord(load(source));
  if (document?.version !== 1) {
    throw new Error("激活声明的 version 必须为 1。");
  }
  const entryWorkflowPaths = stringList(document.entryWorkflowPaths, "entryWorkflowPaths");
  return entryWorkflowPaths.map((path) => {
    const normalizedPath = path.replace(/^harness\//u, "");
    const resolvedPath = layout.workspaceRoot === layout.harnessRoot
      ? normalizedPath.startsWith("workflows/")
        ? resolve(layout.workflowsRoot, normalizedPath.slice("workflows/".length))
        : resolve(rootDir, path)
      : resolve(layout.harnessRoot, normalizedPath);
    const workflowsRoot = layout.workflowsRoot;
    const relativePath = relative(workflowsRoot, resolvedPath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      !relativePath.endsWith(`${sep}workflow.yaml`)
    ) {
      throw new Error(`激活声明中的 Workflow 路径必须位于 workflows/：${path}`);
    }
    return portablePath(rootDir, resolvedPath);
  });
}

async function persistWorkflowCatalog(
  rootDir: string,
  catalog: WorkflowCatalog,
  check: boolean,
  refreshCommand: string,
): Promise<SyncWorkflowCatalogResult> {
  const catalogPath = resolveHarnessLayout(rootDir).catalogPath;
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  let current: string | null = null;
  try {
    current = await readFile(catalogPath, "utf8");
  } catch {
    current = null;
  }
  const changed = current !== serialized;

  if (check) {
    if (changed) {
      throw new Error(`Workflow Catalog 已过期，请执行 ${refreshCommand}。`);
    }
    return { catalog, changed: false };
  }

  if (changed) {
    await mkdir(dirname(catalogPath), { recursive: true });
    const temporaryPath = `${catalogPath}.tmp`;
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, catalogPath);
  }
  return { catalog, changed };
}

export async function syncWorkflowCatalog(
  options: SyncWorkflowCatalogOptions,
): Promise<SyncWorkflowCatalogResult> {
  const rootDir = resolve(options.rootDir);
  const catalog = await buildWorkflowCatalog(rootDir);
  const command = resolveHarnessLayout(rootDir).workspaceRoot === rootDir
    ? "npm run workflow:sync"
    : "./harness-graph/bin/harness-graph sync";
  return persistWorkflowCatalog(rootDir, catalog, options.check === true, command);
}

export async function activateWorkflowCatalog(
  options: ActivateWorkflowCatalogOptions,
): Promise<SyncWorkflowCatalogResult> {
  const rootDir = resolve(options.rootDir);
  const entryWorkflowPaths = await readActivationPaths(rootDir);
  const catalog = resolveSelectedWorkflows(
    entryWorkflowPaths,
    await buildWorkflowCatalog(rootDir),
  );
  const command = resolveHarnessLayout(rootDir).workspaceRoot === rootDir
    ? "npm run workflow:activate"
    : "./harness-graph/bin/harness-graph activate";
  return persistWorkflowCatalog(
    rootDir,
    catalog,
    options.check === true,
    command,
  );
}

export async function checkWorkflowCatalog(options: {
  rootDir: string;
}): Promise<SyncWorkflowCatalogResult> {
  const rootDir = resolve(options.rootDir);
  const catalogPath = resolveHarnessLayout(rootDir).catalogPath;
  let current: Record<string, unknown> | null;
  try {
    current = asRecord(JSON.parse(await readFile(catalogPath, "utf8")) as unknown);
  } catch {
    throw new Error("Workflow Catalog 不存在或无法解析，请先执行 activate。");
  }
  if (current?.mode === "all") {
    return syncWorkflowCatalog({ rootDir, check: true });
  }
  if (current?.mode === "selected") {
    return activateWorkflowCatalog({ rootDir, check: true });
  }
  throw new Error("Workflow Catalog 的 mode 无效，请先执行 activate。");
}

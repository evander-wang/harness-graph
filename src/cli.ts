#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { FlatGraph } from "@openworkflowspec/sdk";

import { checkNodeProject } from "./node-project/project-check.js";
import { checkNodeTypeScriptPolicy } from "./node-project/node-typescript-policy.js";
import {
  checkHarnessProject,
  installHarnessProject,
  resolveHarnessPaths,
  type HarnessPaths,
} from "./installation/installer.js";
import { compileWorkflow } from "./workflow/compiler.js";
import {
  activateWorkflowCatalog,
  checkWorkflowCatalog,
  syncWorkflowCatalog,
} from "./workflow/catalog.js";
import { expandWorkflowPrerequisites } from "./workflow/expanded-graph.js";
import {
  cancelWorkflowRun,
  continueWorkflowRun,
  startWorkflowRun,
  type StepResult,
} from "./workflow/runtime.js";
import {
  loadWorkflowExecutionReport,
  renderWorkflowExecutionReport,
} from "./workflow/report.js";
import { renderWorkflowSvg } from "./workflow/svg-renderer.js";
import { startWorkflowUiServer } from "./workflow/ui-server.js";

export type CliIo = {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const REQUIRED_PATHS = [
  "AGENTS.md",
  "README.md",
  "keywords.md",
  "CONTRIBUTING.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "harness/schemas",
  "harness/models",
  "harness/checks",
  "harness/workflows",
  "harness/skills",
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function printUsage(io: CliIo): void {
  io.stderr(
    "用法：harness-graph " +
      "<install|preflight|route|doctor|project-check|node-policy-check|validate|diagram|image|" +
      "sync|activate|start|continue|cancel|report|ui> [...args]",
  );
}

function commandPaths(io: CliIo): HarnessPaths {
  const explicitHarnessRoot = process.env.HARNESS_GRAPH_ROOT;
  if (explicitHarnessRoot !== undefined) {
    return resolveHarnessPaths({ harnessRoot: explicitHarnessRoot });
  }
  return resolveHarnessPaths({
    ...(process.argv[1] === undefined ? {} : { runtimeEntryPath: process.argv[1] }),
    developmentRoot: io.cwd,
  });
}

function resolveWorkflowArgument(paths: HarnessPaths, path: string): string {
  const resolvedPath = resolve(paths.installed ? paths.harnessRoot : paths.projectRoot, path);
  if (!isInsideWorkspace(paths.workflowsRoot, resolvedPath)) {
    throw new Error("Workflow 路径必须位于 Harness Root 的 workflows/ 内。");
  }
  return resolvedPath;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function doctor(io: CliIo): Promise<number> {
  const missing: string[] = [];
  for (const path of REQUIRED_PATHS) {
    if (!(await exists(resolve(io.cwd, path)))) {
      missing.push(path);
    }
  }

  if (missing.length === 0) {
    io.stdout("仓库结构：通过");
    return 0;
  }

  io.stderr("仓库结构：未通过");
  for (const path of missing) {
    io.stderr(`- 缺失：${path}`);
  }
  return 1;
}

async function projectCheckCommand(requestedRoot: string | undefined, io: CliIo): Promise<number> {
  const paths = commandPaths(io);
  const rootDir = resolve(
    paths.projectRoot,
    requestedRoot ?? process.env.HARNESS_WORKSPACE_ROOT ?? ".",
  );
  const result = await checkNodeProject({ rootDir });
  io.stdout(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

async function changedFiles(rootDir: string): Promise<string[]> {
  const output = await new Promise<string>((resolveOutput, reject) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "-z"],
      { cwd: rootDir, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error ? error : new Error("无法读取 Git 变更列表。", { cause: error }),
          );
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
  return output
    .split("\u0000")
    .filter((entry) => entry.length > 3 && entry[2] === " ")
    .map((entry) => entry.slice(3));
}

async function nodePolicyCheckCommand(
  firstArgument: string | undefined,
  secondArgument: string | undefined,
  io: CliIo,
): Promise<number> {
  try {
    const changedOnly = firstArgument === "--changed";
    const requestedRoot = changedOnly ? secondArgument : firstArgument;
    const paths = commandPaths(io);
    const rootDir = resolve(
      paths.projectRoot,
      requestedRoot ?? process.env.HARNESS_WORKSPACE_ROOT ?? ".",
    );
    const sourcePaths = changedOnly ? await changedFiles(rootDir) : undefined;
    const result = await checkNodeTypeScriptPolicy({
      rootDir,
      standardsPath: join(
        paths.workflowsRoot,
        "node-typescript-standards/STANDARDS.md",
      ),
      ...(sourcePaths === undefined ? {} : { sourcePaths }),
    });
    io.stdout(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? "无法读取 Git 变更列表。" : "Node.js TypeScript 规范检查失败。");
    return 1;
  }
}

async function compileCommand(command: "validate" | "diagram", path: string, io: CliIo): Promise<number> {
  const paths = commandPaths(io);
  let result;
  try {
    result = await compileWorkflow({
      rootDir: paths.harnessRoot,
      workflowPath: resolveWorkflowArgument(paths, path),
    });
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      io.stderr(`[${diagnostic.code}] ${diagnostic.message}`);
    }
    return 1;
  }

  if (command === "validate") {
    io.stdout("Workflow：通过");
  } else if (result.mermaid !== null) {
    io.stdout(result.mermaid);
  }
  return 0;
}

async function diagramCommand(
  workflowPath: string,
  expandPrerequisites: boolean,
  io: CliIo,
): Promise<number> {
  if (!expandPrerequisites) {
    return compileCommand("diagram", workflowPath, io);
  }
  try {
    const paths = commandPaths(io);
    const expanded = await expandWorkflowPrerequisites({
      rootDir: paths.harnessRoot,
      workflowPath: resolveWorkflowArgument(paths, workflowPath),
    });
    io.stdout(expanded.mermaid);
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function isInsideWorkspace(rootDir: string, path: string): boolean {
  return path === rootDir || path.startsWith(`${rootDir}${sep}`);
}

type WorkflowImageSource = {
  graph: FlatGraph;
  workflowName: string;
  title: string;
};

async function loadWorkflowImageSource(
  paths: HarnessPaths,
  workflowPath: string,
  expandPrerequisites: boolean,
): Promise<WorkflowImageSource> {
  if (expandPrerequisites) {
    const expanded = await expandWorkflowPrerequisites({
      rootDir: paths.harnessRoot,
      workflowPath: resolveWorkflowArgument(paths, workflowPath),
    });
    return {
      graph: expanded.graph,
      workflowName: `${expanded.workflowName}-expanded`,
      title: expanded.title,
    };
  }
  const result = await compileWorkflow({
    rootDir: paths.harnessRoot,
    workflowPath: resolveWorkflowArgument(paths, workflowPath),
  });
  if (!result.ok || result.graph === null || result.workflow === null) {
    const message = result.diagnostics
      .map((diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`)
      .join("；");
    throw new Error(message);
  }
  const workflowName = result.workflow.document.name;
  return {
    graph: result.graph,
    workflowName,
    title: result.workflow.document.title ?? workflowName,
  };
}

async function imageCommand(
  workflowPath: string,
  requestedOutputPath: string | undefined,
  expandPrerequisites: boolean,
  io: CliIo,
): Promise<number> {
  const paths = commandPaths(io);
  let source: WorkflowImageSource;
  try {
    source = await loadWorkflowImageSource(paths, workflowPath, expandPrerequisites);
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const rootDir = paths.installed ? paths.harnessRoot : paths.projectRoot;
  const defaultOutput = paths.installed
    ? `generated/${source.workflowName}.svg`
    : `harness/generated/${source.workflowName}.svg`;
  const outputPath = resolve(
    rootDir,
    requestedOutputPath ?? defaultOutput,
  );
  if (!isInsideWorkspace(rootDir, outputPath)) {
    io.stderr("图片输出路径必须位于当前工作区内。");
    return 2;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderWorkflowSvg(source.graph, source.title), "utf8");
  io.stdout(`图片已生成：${relative(rootDir, outputPath)}`);
  return 0;
}

async function syncCommand(check: boolean, io: CliIo): Promise<number> {
  try {
    const result = await syncWorkflowCatalog({ rootDir: commandPaths(io).harnessRoot, check });
    io.stdout(
      check
        ? "Workflow Catalog：已是最新"
        : result.changed
          ? "Workflow Catalog：已同步"
          : "Workflow Catalog：无需更新",
    );
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function activateCommand(check: boolean, io: CliIo): Promise<number> {
  try {
    const rootDir = commandPaths(io).harnessRoot;
    const result = check
      ? await checkWorkflowCatalog({ rootDir })
      : await activateWorkflowCatalog({ rootDir });
    io.stdout(
      check
        ? "Workflow Catalog：激活范围已是最新"
        : result.changed
          ? "Workflow Catalog：已激活"
          : "Workflow Catalog：无需更新",
    );
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function startCommand(
  workflowPath: string,
  executionKey: string,
  inputPath: string,
  io: CliIo,
): Promise<number> {
  try {
    const paths = commandPaths(io);
    const input = await readJson(resolve(paths.projectRoot, inputPath));
    const requestedWorkspaceRoot = asRecord(input)?.projectRoot;
    const response = await startWorkflowRun({
      rootDir: paths.harnessRoot,
      workflowPath,
      executionKey,
      input,
      ...(typeof requestedWorkspaceRoot === "string"
        ? { workspaceRoot: resolve(paths.projectRoot, requestedWorkspaceRoot) }
        : { workspaceRoot: paths.workspaceRoot }),
    });
    io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function continueCommand(
  runId: string,
  resultPath: string | undefined,
  io: CliIo,
): Promise<number> {
  try {
    const paths = commandPaths(io);
    const result =
      resultPath === undefined
        ? undefined
        : ((await readJson(resolve(paths.projectRoot, resultPath))) as StepResult);
    const response = await continueWorkflowRun({
      rootDir: paths.harnessRoot,
      runId,
      ...(result === undefined ? {} : { result }),
    });
    io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function cancelCommand(runId: string, reason: string, io: CliIo): Promise<number> {
  try {
    const response = await cancelWorkflowRun({
      rootDir: commandPaths(io).harnessRoot,
      runId,
      reason,
    });
    io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function reportCommand(
  runId: string,
  format: string | undefined,
  io: CliIo,
): Promise<number> {
  try {
    const report = await loadWorkflowExecutionReport(commandPaths(io).harnessRoot, runId);
    if (format === undefined || format === "json") {
      io.stdout(JSON.stringify(report));
      return 0;
    }
    if (format === "markdown") {
      io.stdout(renderWorkflowExecutionReport(report));
      return 0;
    }
    io.stderr("report format 只支持 json 或 markdown。");
    return 2;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function installCommand(workspace: string | undefined, io: CliIo): Promise<number> {
  try {
    const result = await installHarnessProject({
      sourceRoot: resolve(import.meta.dirname, ".."),
      projectRoot: resolve(io.cwd, workspace ?? "."),
    });
    io.stdout(JSON.stringify(result));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function preflightCommand(io: CliIo): Promise<number> {
  try {
    const result = await checkHarnessProject({
      ...(process.argv[1] === undefined ? {} : { runtimeEntryPath: process.argv[1] }),
      requireLocalRuntime: true,
    });
    io.stdout(JSON.stringify(result));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function routeCommand(io: CliIo): Promise<number> {
  try {
    await checkHarnessProject({
      ...(process.argv[1] === undefined ? {} : { runtimeEntryPath: process.argv[1] }),
      requireLocalRuntime: true,
    });
    const paths = commandPaths(io);
    io.stdout(JSON.stringify({
      kind: "harness-graph.router-directive",
      routerSkillPath: relative(
        paths.projectRoot,
        join(paths.skillsRoot, "workflow-router/SKILL.md"),
      ),
      catalogPath: relative(paths.projectRoot, paths.catalogPath),
      instruction: "加载 Router Skill，并由当前 Agent 按其指令调用本地 CLI；CLI 不会自主控制外部 Agent。",
    }));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function uiCommand(portArgument: string | undefined, io: CliIo): Promise<number> {
  const port = portArgument === undefined ? 4173 : Number(portArgument);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    io.stderr("ui 端口必须是 0 到 65535 之间的整数。");
    return 2;
  }
  try {
    const paths = commandPaths(io);
    await startWorkflowUiServer({
      rootDir: paths.installed ? paths.harnessRoot : paths.projectRoot,
      port,
    });
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function missingArguments(io: CliIo): number {
  printUsage(io);
  return 2;
}

type CommandHandler = (args: string[], io: CliIo) => Promise<number> | number;

const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  install: ([workspace], io) => installCommand(workspace, io),
  preflight: (_args, io) => preflightCommand(io),
  route: (_args, io) => routeCommand(io),
  doctor: (_args, io) => doctor(io),
  "project-check": ([requestedRoot], io) => projectCheckCommand(requestedRoot, io),
  "node-policy-check": ([firstArgument, secondArgument], io) =>
    nodePolicyCheckCommand(firstArgument, secondArgument, io),
  validate: ([path], io) =>
    path === undefined ? missingArguments(io) : compileCommand("validate", path, io),
  diagram: ([path, ...options], io) =>
    path === undefined
      ? missingArguments(io)
      : diagramCommand(path, options.includes("--expand-prerequisites"), io),
  image: ([path, ...options], io) => {
    if (path === undefined) {
      return missingArguments(io);
    }
    const expandPrerequisites = options.includes("--expand-prerequisites");
    const outputPath = options.find((option) => option !== "--expand-prerequisites");
    return imageCommand(path, outputPath, expandPrerequisites, io);
  },
  sync: ([option], io) => syncCommand(option === "--check", io),
  activate: ([option], io) => activateCommand(option === "--check", io),
  start: ([workflowPath, executionKey, inputPath], io) =>
    workflowPath === undefined || executionKey === undefined || inputPath === undefined
      ? missingArguments(io)
      : startCommand(workflowPath, executionKey, inputPath, io),
  continue: ([runId, resultPath], io) =>
    runId === undefined ? missingArguments(io) : continueCommand(runId, resultPath, io),
  cancel: ([runId, reason], io) =>
    runId === undefined || reason === undefined
      ? missingArguments(io)
      : cancelCommand(runId, reason, io),
  report: ([runId, option, optionValue], io) =>
    runId === undefined
      ? missingArguments(io)
      : reportCommand(
          runId,
          option === "--format" ? optionValue : option?.replace(/^--format=/u, ""),
          io,
        ),
  ui: ([port], io) => uiCommand(port, io),
  "workflow-ui": ([port], io) => uiCommand(port, io),
};

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  const handler = command === undefined ? undefined : COMMAND_HANDLERS[command];
  return handler === undefined ? missingArguments(io) : handler(args, io);
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url))
) {
  const code = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: console.log,
    stderr: console.error,
  });
  process.exitCode = code;
}

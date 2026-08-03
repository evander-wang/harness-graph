import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";

import { activateWorkflowCatalog, checkWorkflowCatalog } from "../workflow/catalog.js";

import {
  resolveHarnessPaths,
  type HarnessPaths,
  type ResolveHarnessPathsOptions,
} from "./paths.js";

const AGENT_START_MARKER = "<!-- harness-next:start version=1 -->";
const AGENT_END_MARKER = "<!-- harness-next:end -->";
const GITIGNORE_START_MARKER = "# harness-next:start";
const GITIGNORE_END_MARKER = "# harness-next:end";

const AGENT_BLOCK = `${AGENT_START_MARKER}
## Harness Next

处理本项目的任何开发任务前，必须先执行：

\`./harness-next/bin/harness-next route\`

必须遵循 Runtime 返回的当前 Step，不得自行解析 Workflow、跳过 Check 或直接进入后续 Step。

\`harness-next/workflows/\`、\`harness-next/models/\`、\`harness-next/checks/\` 和
\`harness-next/skills/\` 是本项目维护的 Harness 事实源。

本文件其余项目开发规范继续有效。入口不可用、preflight 失败或 Workflow
进入 blocked 状态时，必须停止并报告，不得绕过 Harness Next。
${AGENT_END_MARKER}
`;

const GITIGNORE_BLOCK = `${GITIGNORE_START_MARKER}
harness-next/runtime/node_modules/
harness-next/.state/
${GITIGNORE_END_MARKER}
`;

const RUNTIME_ENTRIES = [
  ["dist", "runtime/dist"],
  ["package.json", "runtime/package.json"],
  ["package-lock.json", "runtime/package-lock.json"],
] as const;

const MAINTAINED_ENTRIES = [
  ["harness/workflows", "workflows"],
  ["harness/models", "models"],
  ["harness/checks", "checks"],
  ["skills", "skills"],
  ["harness/workflow-activation.yaml", "workflow-activation.yaml"],
  ["harness/generated/workflow-catalog.json", "generated/workflow-catalog.json"],
] as const;

export type InstallHarnessProjectOptions = {
  sourceRoot: string;
  projectRoot?: string;
  now?: () => Date;
  installRuntimeDependencies?: boolean;
};

export type InstallHarnessProjectResult = {
  status: "installed";
  changed: boolean;
  projectRoot: ".";
  harnessRoot: "harness-next";
  command: "./harness-next/bin/harness-next route";
  maintainedEntries: string[];
};

export type CheckHarnessProjectOptions = {
  projectRoot?: string;
  harnessRoot?: string;
  runtimeEntryPath?: string;
  requireLocalRuntime?: boolean;
};

export type CheckHarnessProjectResult = {
  status: "ready";
  projectRoot: ".";
  harnessRoot: "harness-next";
  recoverableRun: boolean;
};

type InstallationManifest = {
  schemaVersion: 1;
  layoutVersion: 1;
  harnessVersion: string;
  installedAt: string;
  managedEntries: {
    agents: true;
    claude: true;
    gitignore: true;
  };
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function countOccurrences(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function assertManagedBlock(
  source: string,
  startMarker: string,
  endMarker: string,
  path: string,
): void {
  const starts = countOccurrences(source, startMarker);
  const ends = countOccurrences(source, endMarker);
  if (starts !== 1 || ends !== 1 || source.indexOf(startMarker) > source.indexOf(endMarker)) {
    throw new Error(`${path} 的 Harness Next 托管块必须存在且唯一。`);
  }
}

function renderManagedFile(
  source: string,
  startMarker: string,
  endMarker: string,
  block: string,
  path: string,
): string {
  const starts = countOccurrences(source, startMarker);
  const ends = countOccurrences(source, endMarker);
  if (starts > 1 || ends > 1 || starts !== ends) {
    throw new Error(`${path} 中的 Harness Next 托管块损坏或重复。`);
  }
  if (starts === 0) {
    return source.length === 0 ? block : `${block}\n${source}`;
  }
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < start) {
    throw new Error(`${path} 中的 Harness Next 托管块损坏或重复。`);
  }
  const afterMarker = end + endMarker.length;
  const suffixStart = source.startsWith("\r\n", afterMarker)
    ? afterMarker + 2
    : source.startsWith("\n", afterMarker)
      ? afterMarker + 1
      : afterMarker;
  return `${source.slice(0, start)}${block}${source.slice(suffixStart)}`;
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function assertRegularFileOrMissing(path: string): Promise<void> {
  try {
    const entry = await stat(path);
    if (!entry.isFile()) {
      throw new Error(`${path} 不是普通文件。`);
    }
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

type ManagedFileUpdate = {
  path: string;
  current: string;
  next: string;
  existed: boolean;
};

async function prepareManagedProjectFiles(projectRoot: string): Promise<ManagedFileUpdate[]> {
  const definitions = [
    ["AGENTS.md", AGENT_START_MARKER, AGENT_END_MARKER, AGENT_BLOCK],
    ["CLAUDE.md", AGENT_START_MARKER, AGENT_END_MARKER, AGENT_BLOCK],
    [".gitignore", GITIGNORE_START_MARKER, GITIGNORE_END_MARKER, GITIGNORE_BLOCK],
  ] as const;
  const updates: ManagedFileUpdate[] = [];
  for (const [name, startMarker, endMarker, block] of definitions) {
    const path = join(projectRoot, name);
    await assertRegularFileOrMissing(path);
    const existed = await exists(path);
    const current = await readOptionalFile(path);
    const next = renderManagedFile(current, startMarker, endMarker, block, name);
    updates.push({ path, current, next, existed });
  }
  return updates;
}

async function writeManagedProjectFiles(updates: readonly ManagedFileUpdate[]): Promise<boolean> {
  let changed = false;
  try {
    for (const update of updates) {
      if (update.next !== update.current) {
        await writeFile(update.path, update.next, "utf8");
        changed = true;
      }
    }
  } catch (error: unknown) {
    await restoreManagedProjectFiles(updates);
    throw error;
  }
  return changed;
}

async function restoreManagedProjectFiles(updates: readonly ManagedFileUpdate[]): Promise<void> {
  for (const update of updates) {
    if (update.existed) await writeFile(update.path, update.current, "utf8");
    else await rm(update.path, { force: true });
  }
}

async function readHarnessVersion(sourceRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")) as unknown;
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error("Harness Next package.json 缺少有效 version。");
  }
  return packageJson.version;
}

async function copyPayload(sourceRoot: string, harnessRoot: string): Promise<void> {
  for (const [source, target] of [...RUNTIME_ENTRIES, ...MAINTAINED_ENTRIES]) {
    await cp(join(sourceRoot, source), join(harnessRoot, target), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

async function writeLauncher(harnessRoot: string): Promise<void> {
  const binRoot = join(harnessRoot, "bin");
  await mkdir(binRoot, { recursive: true });
  const launcherPath = join(binRoot, "harness-next");
  await writeFile(
    launcherPath,
    '#!/usr/bin/env sh\nset -eu\n\nHARNESS_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec node "$HARNESS_ROOT/runtime/dist/cli.js" "$@"\n',
    "utf8",
  );
  await chmod(launcherPath, 0o755);
}

async function installRuntimeDependencies(runtimeRoot: string): Promise<void> {
  await new Promise<void>((resolveInstall, reject) => {
    execFile(
      "npm",
      ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: runtimeRoot, encoding: "utf8" },
      (error) => {
        if (error === null) {
          resolveInstall();
          return;
        }
        reject(new Error("项目本地 Runtime 依赖安装失败。", { cause: error }));
      },
    );
  });
}

async function readManifest(path: string): Promise<InstallationManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const value = typeof parsed === "object" && parsed !== null
    ? parsed as Record<string, unknown>
    : {};
  const managed = typeof value.managedEntries === "object" && value.managedEntries !== null
    ? value.managedEntries as Record<string, unknown>
    : {};
  if (
    value.schemaVersion !== 1 ||
    value.layoutVersion !== 1 ||
    typeof value.harnessVersion !== "string" ||
    typeof value.installedAt !== "string" ||
    managed.agents !== true ||
    managed.claude !== true ||
    managed.gitignore !== true
  ) {
    throw new Error("现有 Harness Next 安装清单版本不受支持。");
  }
  return {
    schemaVersion: 1,
    layoutVersion: 1,
    harnessVersion: value.harnessVersion,
    installedAt: value.installedAt,
    managedEntries: { agents: true, claude: true, gitignore: true },
  };
}

async function assertDirectory(path: string, displayPath: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new Error(`${displayPath} 缺失或不是目录。`);
    }
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${displayPath} 缺失或不是目录。`);
    }
    throw error;
  }
}

async function assertRegularFile(path: string, displayPath: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error(`${displayPath} 必须是普通文件。`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${displayPath} 缺失。`);
    }
    throw error;
  }
}

async function hasRecoverableRun(stateRoot: string): Promise<boolean> {
  const runsRoot = join(stateRoot, "runs");
  for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const parsed = JSON.parse(
      await readFile(join(runsRoot, entry.name, "state.json"), "utf8"),
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("status" in parsed)) {
      throw new Error(`Workflow Run '${entry.name}' 状态文件无效。`);
    }
    if (parsed.status === "running") return true;
  }
  return false;
}

export async function checkHarnessProject(
  options: CheckHarnessProjectOptions,
): Promise<CheckHarnessProjectResult> {
  assertSupportedNodeVersion();
  const paths = resolveHarnessPaths({
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    ...(options.harnessRoot === undefined ? {} : { harnessRoot: options.harnessRoot }),
    ...(options.runtimeEntryPath === undefined
      ? {}
      : { runtimeEntryPath: options.runtimeEntryPath }),
  });
  if (!paths.installed) {
    throw new Error("preflight 必须从项目本地 Runtime 执行。");
  }
  if (options.requireLocalRuntime === true) {
    const expectedEntry = join(paths.runtimeRoot, "dist/cli.js");
    if (options.runtimeEntryPath === undefined || resolve(options.runtimeEntryPath) !== expectedEntry) {
      throw new Error("当前命令不是从项目本地 Runtime 执行。");
    }
  }
  await readManifest(paths.installationPath);
  for (const path of [
    "runtime/dist/cli.js",
    "runtime/package.json",
    "runtime/package-lock.json",
    "bin/harness-next",
    "workflow-activation.yaml",
    "generated/workflow-catalog.json",
    "skills/workflow-router/SKILL.md",
  ]) {
    await assertRegularFile(join(paths.harnessRoot, path), `harness-next/${path}`);
  }
  for (const path of ["workflows", "models", "checks", "skills"]) {
    await assertDirectory(join(paths.harnessRoot, path), `harness-next/${path}`);
  }
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    assertManagedBlock(
      await readFile(join(paths.projectRoot, name), "utf8"),
      AGENT_START_MARKER,
      AGENT_END_MARKER,
      name,
    );
  }
  const gitignore = await readFile(join(paths.projectRoot, ".gitignore"), "utf8");
  assertManagedBlock(
    gitignore,
    GITIGNORE_START_MARKER,
    GITIGNORE_END_MARKER,
    ".gitignore",
  );
  if (
    !gitignore.includes("harness-next/.state/") ||
    !gitignore.includes("harness-next/runtime/node_modules/")
  ) {
    throw new Error(".gitignore 未完整忽略 Harness Next 本地状态和 Runtime 依赖。");
  }
  await checkWorkflowCatalog({ rootDir: paths.harnessRoot });
  await mkdir(join(paths.stateRoot, "runs"), { recursive: true });
  await mkdir(join(paths.stateRoot, "tmp"), { recursive: true });
  const probePath = join(paths.stateRoot, "tmp", `.preflight-${randomUUID()}`);
  await writeFile(probePath, "", "utf8");
  await rm(probePath);
  return {
    status: "ready",
    projectRoot: ".",
    harnessRoot: "harness-next",
    recoverableRun: await hasRecoverableRun(paths.stateRoot),
  };
}

async function maintainedEntryChanges(
  sourceRoot: string,
  harnessRoot: string,
): Promise<string[]> {
  const changed: string[] = [];
  const visit = async (sourcePath: string, targetPath: string, displayPath: string): Promise<void> => {
    const sourceStat = await stat(sourcePath);
    if (sourceStat.isDirectory()) {
      for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
        await visit(
          join(sourcePath, entry.name),
          join(targetPath, entry.name),
          join(displayPath, entry.name),
        );
      }
      return;
    }
    if (!(await exists(targetPath))) {
      changed.push(displayPath.split("\\").join("/"));
      return;
    }
    const [source, target] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
    if (!source.equals(target)) {
      changed.push(displayPath.split("\\").join("/"));
    }
  };
  for (const [source, target] of MAINTAINED_ENTRIES) {
    if (target === "generated/workflow-catalog.json") continue;
    await visit(join(sourceRoot, source), join(harnessRoot, target), target);
  }
  return changed;
}

function assertSupportedNodeVersion(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 22) {
    throw new Error("Harness Next 需要 Node.js 22 或更高版本。");
  }
}

export async function installHarnessProject(
  options: InstallHarnessProjectOptions,
): Promise<InstallHarnessProjectResult> {
  assertSupportedNodeVersion();
  const sourceRoot = resolve(options.sourceRoot);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const paths = resolveHarnessPaths({ projectRoot });
  const projectEntry = await stat(projectRoot);
  if (!projectEntry.isDirectory()) {
    throw new Error("安装目标必须是本地目录。");
  }
  await access(projectRoot, constants.R_OK | constants.W_OK);

  if (await exists(paths.harnessRoot)) {
    const harnessEntry = await stat(paths.harnessRoot);
    if (!harnessEntry.isDirectory()) {
      throw new Error("harness-next 已存在且不是目录。");
    }
    if (!(await exists(paths.installationPath))) {
      throw new Error("harness-next 已存在但不是受支持的 Harness Next 安装。");
    }
    await readManifest(paths.installationPath);
    for (const required of [
      "runtime/dist/cli.js",
      "runtime/package.json",
      "runtime/package-lock.json",
      "bin/harness-next",
    ]) {
      if (!(await exists(join(paths.harnessRoot, required)))) {
        throw new Error(`Runtime 必需文件缺失：${required}；请使用后续 repair 命令修复。`);
      }
    }
    const maintainedEntries = await maintainedEntryChanges(sourceRoot, paths.harnessRoot);
    const managedUpdates = await prepareManagedProjectFiles(projectRoot);
    const managedChanged = await writeManagedProjectFiles(managedUpdates);
    return {
      status: "installed",
      changed: managedChanged,
      projectRoot: ".",
      harnessRoot: "harness-next",
      command: "./harness-next/bin/harness-next route",
      maintainedEntries,
    };
  }

  const managedUpdates = await prepareManagedProjectFiles(projectRoot);
  const temporaryRoot = await mkdtemp(join(projectRoot, ".harness-next-install-"));
  const stagedHarnessRoot = join(temporaryRoot, "harness-next");
  let managedFilesChanged = false;
  let harnessInstalled = false;
  try {
    await mkdir(stagedHarnessRoot);
    await copyPayload(sourceRoot, stagedHarnessRoot);
    await writeLauncher(stagedHarnessRoot);
    if (options.installRuntimeDependencies !== false) {
      await installRuntimeDependencies(join(stagedHarnessRoot, "runtime"));
    }
    const manifest: InstallationManifest = {
      schemaVersion: 1,
      layoutVersion: 1,
      harnessVersion: await readHarnessVersion(sourceRoot),
      installedAt: (options.now ?? (() => new Date()))().toISOString(),
      managedEntries: { agents: true, claude: true, gitignore: true },
    };
    await writeFile(
      join(stagedHarnessRoot, "installation.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await mkdir(join(stagedHarnessRoot, ".state/runs"), { recursive: true });
    await mkdir(join(stagedHarnessRoot, ".state/tmp"), { recursive: true });
    await activateWorkflowCatalog({ rootDir: stagedHarnessRoot });
    managedFilesChanged = await writeManagedProjectFiles(managedUpdates);
    await rename(stagedHarnessRoot, paths.harnessRoot);
    harnessInstalled = true;
    await checkHarnessProject({ projectRoot });
  } catch (error: unknown) {
    if (harnessInstalled) await rm(paths.harnessRoot, { recursive: true, force: true });
    if (managedFilesChanged) await restoreManagedProjectFiles(managedUpdates);
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  return {
    status: "installed",
    changed: true,
    projectRoot: ".",
    harnessRoot: "harness-next",
    command: "./harness-next/bin/harness-next route",
    maintainedEntries: [],
  };
}

export { resolveHarnessPaths };
export type { HarnessPaths, ResolveHarnessPathsOptions };

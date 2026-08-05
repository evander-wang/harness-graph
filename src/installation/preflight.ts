import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { checkWorkflowCatalog } from "../workflow/catalog.js";

import {
  AGENT_END_MARKER,
  AGENT_START_MARKER,
  GITIGNORE_END_MARKER,
  GITIGNORE_START_MARKER,
  assertManagedBlock,
} from "./managed-project-files.js";
import { readInstallationManifest, type InstallationManifestState } from "./manifest.js";
import { resolveHarnessPaths, type HarnessPaths } from "./paths.js";
import { assertProjectSkillAdapters } from "./project-skills.js";
import { hashRuntimeArtifacts } from "./runtime.js";
import { assertSupportedNodeVersion } from "./runtime-installation.js";

export type CheckHarnessProjectOptions = {
  projectRoot?: string;
  harnessRoot?: string;
  runtimeEntryPath?: string;
  requireLocalRuntime?: boolean;
};

export type CheckHarnessProjectResult = {
  status: "ready";
  projectRoot: ".";
  harnessRoot: "harness-graph";
  recoverableRun: boolean;
};

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

export async function assertRegularFile(path: string, displayPath: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error(`${displayPath} 必须是普通文件。`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${displayPath} 缺失。`);
    }
    throw error;
  }
}

export async function hasRecoverableRun(stateRoot: string): Promise<boolean> {
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

function resolvePreflightPaths(options: CheckHarnessProjectOptions): HarnessPaths {
  return resolveHarnessPaths({
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    ...(options.harnessRoot === undefined ? {} : { harnessRoot: options.harnessRoot }),
    ...(options.runtimeEntryPath === undefined
      ? {}
      : { runtimeEntryPath: options.runtimeEntryPath }),
  });
}

function assertLocalRuntime(paths: HarnessPaths, options: CheckHarnessProjectOptions): void {
  if (!paths.installed) throw new Error("preflight 必须从项目本地 Runtime 执行。");
  if (options.requireLocalRuntime !== true) return;
  const expectedEntry = join(paths.runtimeRoot, "dist/cli.js");
  if (options.runtimeEntryPath === undefined) {
    throw new Error("当前命令不是从项目本地 Runtime 执行。");
  }
  if (resolve(options.runtimeEntryPath) !== expectedEntry) {
    throw new Error("当前命令不是从项目本地 Runtime 执行。");
  }
}

async function assertManifestReady(paths: HarnessPaths): Promise<InstallationManifestState> {
  const state = await readInstallationManifest(paths.installationPath);
  if (state.needsLayoutMigration) {
    throw new Error("Harness Graph 安装需要先重新执行 install 完成布局迁移。");
  }
  if (state.needsProjectSkillMigration) {
    throw new Error("Harness Graph 安装需要先重新执行 install 完成项目级 Skill 迁移。");
  }
  return state;
}

async function assertInstalledEntries(paths: HarnessPaths): Promise<void> {
  const files = [
    "runtime/dist/cli.js",
    "runtime/package.json",
    "runtime/package-lock.json",
    "bin/harness-graph",
    "workflow-activation.yaml",
    "generated/workflow-catalog.json",
    "skills/harness-graph/SKILL.md",
    "skills/workflow-router/SKILL.md",
  ];
  for (const path of files) {
    await assertRegularFile(join(paths.harnessRoot, path), `harness-graph/${path}`);
  }
  for (const path of ["workflows", "models", "checks", "skills"]) {
    await assertDirectory(join(paths.harnessRoot, path), `harness-graph/${path}`);
  }
}

async function assertRuntimeIntegrity(
  paths: HarnessPaths,
  manifestState: InstallationManifestState,
): Promise<void> {
  const expected = manifestState.manifest.runtime?.hash;
  if (expected === undefined) return;
  if (await hashRuntimeArtifacts(paths.runtimeRoot) !== expected) {
    throw new Error("项目本地 Runtime 与安装清单哈希不一致。");
  }
}

async function assertManagedProjectIntegration(paths: HarnessPaths): Promise<void> {
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
  const ignoresState = gitignore.includes("harness-graph/.state/");
  const ignoresRuntime = gitignore.includes("harness-graph/runtime/node_modules/");
  if (!ignoresState || !ignoresRuntime) {
    throw new Error(".gitignore 未完整忽略 Harness Graph 本地状态和 Runtime 依赖。");
  }
  await assertProjectSkillAdapters(paths.projectRoot);
}

async function assertWritableState(paths: HarnessPaths): Promise<boolean> {
  await mkdir(join(paths.stateRoot, "runs"), { recursive: true });
  await mkdir(join(paths.stateRoot, "tmp"), { recursive: true });
  const probePath = join(paths.stateRoot, "tmp", `.preflight-${randomUUID()}`);
  await writeFile(probePath, "", "utf8");
  await rm(probePath);
  return hasRecoverableRun(paths.stateRoot);
}

export async function checkHarnessProject(
  options: CheckHarnessProjectOptions,
): Promise<CheckHarnessProjectResult> {
  assertSupportedNodeVersion();
  const paths = resolvePreflightPaths(options);
  assertLocalRuntime(paths, options);
  const manifestState = await assertManifestReady(paths);
  await assertInstalledEntries(paths);
  await assertRuntimeIntegrity(paths, manifestState);
  await assertManagedProjectIntegration(paths);
  await checkWorkflowCatalog({ rootDir: paths.harnessRoot });
  return {
    status: "ready",
    projectRoot: ".",
    harnessRoot: "harness-graph",
    recoverableRun: await assertWritableState(paths),
  };
}

import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

import { activateWorkflowCatalog } from "../workflow/catalog.js";
import {
  resolveHarnessPaths,
  type HarnessPaths,
  type ResolveHarnessPathsOptions,
} from "./paths.js";
import {
  readInstallationManifest,
  writeInstallationManifestAtomically,
  type InstallationManifest,
  type InstallationManifestState,
} from "./manifest.js";
import {
  assertProjectSkillAdapters,
  prepareLegacyBrandProjectSkillAdapters,
  prepareLegacyProjectSkills,
  prepareProjectSkillAdapters,
  removeLegacyBrandProjectSkillAdapters,
  restoreLegacyBrandProjectSkillAdapters,
  restoreProjectSkillAdapters,
  writeProjectSkillAdapters,
} from "./project-skills.js";
import { hashRuntimeArtifacts } from "./runtime.js";
import { generateRuntimeLock, writeRuntimePackage } from "./runtime-package.js";
import {
  CURRENT_LAYOUT_VERSION,
  HARNESS_ROOT_DIRECTORY,
  LEGACY_HARNESS_CLI_NAME,
  LEGACY_HARNESS_ROOT_DIRECTORY,
  LEGACY_LAYOUT_VERSION,
} from "./layout.js";
import {
  prepareManagedProjectFiles,
  restoreManagedProjectFiles,
  writeManagedProjectFiles,
} from "./managed-project-files.js";
import { stageLegacyPublishedAssets } from "./legacy-assets.js";
import {
  copyPayload,
  maintainedEntryChanges,
  prepareMaintainedAssetChanges,
  readHarnessVersion,
  renderMaintainedAssetPreview,
  restoreMaintainedAssetChanges,
  writeMaintainedAssetChanges,
  type MaintainedAssetChange,
  type MaintainedAssetPreview,
} from "./payload.js";
import {
  assertSupportedNodeVersion,
  installRuntimeDependencies,
  stageRuntime,
  writeLauncher,
  type StagedRuntime,
} from "./runtime-installation.js";
import {
  assertRegularFile,
  checkHarnessProject,
  hasRecoverableRun,
  type CheckHarnessProjectOptions,
  type CheckHarnessProjectResult,
} from "./preflight.js";

export type InstallHarnessProjectOptions = {
  sourceRoot: string;
  projectRoot?: string;
  now?: () => Date;
  installRuntimeDependencies?: boolean;
  overwriteMaintainedAssets?: boolean;
};

export type PreviewHarnessAssetChangesOptions = {
  sourceRoot: string;
  projectRoot?: string;
};

export type InstallHarnessProjectResult = {
  status: "installed";
  changed: boolean;
  projectRoot: ".";
  harnessRoot: "harness-graph";
  command: "./harness-graph/bin/harness-graph route";
  maintainedEntries: string[];
  overwrittenEntries: string[];
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

async function validateLegacyHarnessProject(
  legacyHarnessRoot: string,
): Promise<InstallationManifestState> {
  const legacyEntry = await stat(legacyHarnessRoot);
  if (!legacyEntry.isDirectory()) {
    throw new Error(`${LEGACY_HARNESS_ROOT_DIRECTORY} 已存在且不是目录。`);
  }
  const legacyInstallationPath = join(legacyHarnessRoot, "installation.json");
  if (!(await exists(legacyInstallationPath))) {
    throw new Error(
      `${LEGACY_HARNESS_ROOT_DIRECTORY} 已存在但不是受支持的 Harness Next 安装。`,
    );
  }
  const manifestState = await readInstallationManifest(legacyInstallationPath);
  if (manifestState.manifest.layoutVersion !== LEGACY_LAYOUT_VERSION) {
    throw new Error("旧 Harness Next 目录的安装布局版本不是 v1，无法自动迁移。");
  }
  for (const required of [
    "runtime/dist/cli.js",
    "runtime/package.json",
    "runtime/package-lock.json",
    `bin/${LEGACY_HARNESS_CLI_NAME}`,
  ]) {
    await assertRegularFile(
      join(legacyHarnessRoot, required),
      `${LEGACY_HARNESS_ROOT_DIRECTORY}/${required}`,
    );
  }
  if (manifestState.manifest.runtime !== undefined) {
    const runtimeHash = await hashRuntimeArtifacts(join(legacyHarnessRoot, "runtime"));
    if (runtimeHash !== manifestState.manifest.runtime.hash) {
      throw new Error("旧项目本地 Runtime 已被修改，无法自动迁移。`install` 未修改原安装。");
    }
  }
  if (await hasRecoverableRun(join(legacyHarnessRoot, ".state"))) {
    throw new Error("项目存在运行中的 Run，不能迁移 Harness Root。请先完成或取消该 Run。");
  }
  return manifestState;
}

async function createMigratedManifest(
  sourceRoot: string,
  installedAt: string,
  stagedRuntime: StagedRuntime,
): Promise<InstallationManifest> {
  return {
    schemaVersion: 1,
    layoutVersion: CURRENT_LAYOUT_VERSION,
    harnessVersion: await readHarnessVersion(sourceRoot),
    installedAt,
    runtime: {
      version: stagedRuntime.version,
      hash: stagedRuntime.hash,
      stateSchemaVersion: 1,
    },
    managedEntries: {
      agents: true,
      claude: true,
      gitignore: true,
      codexSkill: true,
      claudeSkill: true,
    },
  };
}

type LegacyMigrationRollback = {
  legacyRootMoved: boolean;
  legacyProjectSkillsRemoved: boolean;
  harnessInstalled: boolean;
  projectSkillsChanged: boolean;
  managedChanged: boolean;
};

async function rollbackLegacyMigration(
  state: LegacyMigrationRollback,
  paths: HarnessPaths,
  projectRoot: string,
  legacyHarnessRoot: string,
  legacyBackupRoot: string,
  legacyProjectSkillAdapters: Awaited<ReturnType<typeof prepareLegacyBrandProjectSkillAdapters>>,
  projectSkillAdapters: Awaited<ReturnType<typeof prepareProjectSkillAdapters>>,
  managedUpdates: Awaited<ReturnType<typeof prepareManagedProjectFiles>>,
): Promise<void> {
  if (state.legacyRootMoved) await rename(legacyBackupRoot, legacyHarnessRoot);
  if (state.legacyProjectSkillsRemoved) {
    await restoreLegacyBrandProjectSkillAdapters(legacyProjectSkillAdapters);
  }
  if (state.harnessInstalled) await rm(paths.harnessRoot, { recursive: true, force: true });
  if (state.projectSkillsChanged) {
    await restoreProjectSkillAdapters(projectRoot, projectSkillAdapters);
  }
  if (state.managedChanged) await restoreManagedProjectFiles(managedUpdates);
}

async function migrateLegacyHarnessProject(
  options: InstallHarnessProjectOptions,
  sourceRoot: string,
  projectRoot: string,
  paths: HarnessPaths,
  legacyHarnessRoot: string,
): Promise<InstallHarnessProjectResult> {
  const manifestState = await validateLegacyHarnessProject(legacyHarnessRoot);

  const managedUpdates = await prepareManagedProjectFiles(projectRoot, true);
  const projectSkillAdapters = await prepareProjectSkillAdapters(projectRoot);
  const legacyProjectSkillAdapters = await prepareLegacyBrandProjectSkillAdapters(projectRoot);
  const temporaryRoot = await mkdtemp(join(projectRoot, ".harness-graph-migration-"));
  const stagedHarnessRoot = join(temporaryRoot, HARNESS_ROOT_DIRECTORY);
  const legacyBackupRoot = join(temporaryRoot, LEGACY_HARNESS_ROOT_DIRECTORY);
  const state: LegacyMigrationRollback = {
    managedChanged: false,
    projectSkillsChanged: false,
    harnessInstalled: false,
    legacyProjectSkillsRemoved: false,
    legacyRootMoved: false,
  };
  try {
    await stageLegacyPublishedAssets(sourceRoot, legacyHarnessRoot, stagedHarnessRoot);
    const stagedRuntime = await stageRuntime(sourceRoot, join(temporaryRoot, "runtime-stage"));
    if (options.installRuntimeDependencies !== false) {
      await installRuntimeDependencies(stagedRuntime.root);
    }
    await rename(stagedRuntime.root, join(stagedHarnessRoot, "runtime"));
    await writeLauncher(stagedHarnessRoot);
    const nextManifest = await createMigratedManifest(
      sourceRoot,
      manifestState.manifest.installedAt,
      stagedRuntime,
    );
    await writeFile(
      join(stagedHarnessRoot, "installation.json"),
      `${JSON.stringify(nextManifest, null, 2)}\n`,
      "utf8",
    );
    await activateWorkflowCatalog({ rootDir: stagedHarnessRoot });
    state.managedChanged = await writeManagedProjectFiles(managedUpdates);
    state.projectSkillsChanged = await writeProjectSkillAdapters(
      projectRoot,
      projectSkillAdapters,
    );
    await rename(stagedHarnessRoot, paths.harnessRoot);
    state.harnessInstalled = true;
    await checkHarnessProject({ projectRoot });
    await removeLegacyBrandProjectSkillAdapters(projectRoot, legacyProjectSkillAdapters);
    state.legacyProjectSkillsRemoved = legacyProjectSkillAdapters.length > 0;
    await rename(legacyHarnessRoot, legacyBackupRoot);
    state.legacyRootMoved = true;
    const maintainedEntries = await maintainedEntryChanges(sourceRoot, paths.harnessRoot);
    await rm(legacyBackupRoot, { recursive: true, force: true });
    state.legacyRootMoved = false;
    return {
      status: "installed",
      changed: true,
      projectRoot: ".",
      harnessRoot: "harness-graph",
      command: "./harness-graph/bin/harness-graph route",
      maintainedEntries,
      overwrittenEntries: [],
    };
  } catch (error: unknown) {
    await rollbackLegacyMigration(
      state,
      paths,
      projectRoot,
      legacyHarnessRoot,
      legacyBackupRoot,
      legacyProjectSkillAdapters,
      projectSkillAdapters,
      managedUpdates,
    );
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function assertCurrentInstallation(paths: HarnessPaths): Promise<InstallationManifestState> {
  if (!(await stat(paths.harnessRoot)).isDirectory()) {
    throw new Error("harness-graph 已存在且不是目录。");
  }
  if (!(await exists(paths.installationPath))) {
    throw new Error("harness-graph 已存在但不是受支持的 Harness Graph 安装。");
  }
  const required = [
    "runtime/dist/cli.js",
    "runtime/package.json",
    "runtime/package-lock.json",
    "bin/harness-graph",
  ];
  for (const path of required) {
    if (!(await exists(join(paths.harnessRoot, path)))) {
      throw new Error(`Runtime 必需文件缺失：${path}；请使用后续 repair 命令修复。`);
    }
  }
  return readInstallationManifest(paths.installationPath);
}

async function prepareRuntimeUpgrade(
  sourceRoot: string,
  temporaryRoot: string,
  paths: HarnessPaths,
  manifestState: InstallationManifestState,
): Promise<{ staged: StagedRuntime; changed: boolean }> {
  const staged = await stageRuntime(sourceRoot, temporaryRoot);
  const currentHash = await hashRuntimeArtifacts(paths.runtimeRoot);
  const expectedHash = manifestState.manifest.runtime?.hash;
  if (expectedHash !== undefined && currentHash !== expectedHash) {
    throw new Error("项目本地 Runtime 已被修改，无法自动升级。");
  }
  const changed = currentHash !== staged.hash;
  if (changed && await hasRecoverableRun(paths.stateRoot)) {
    throw new Error("项目存在运行中的 Run，不能升级 Runtime。");
  }
  return { staged, changed };
}

async function prepareUpgradeSkills(
  projectRoot: string,
  sourceRoot: string,
  manifestState: InstallationManifestState,
): Promise<Awaited<ReturnType<typeof prepareLegacyProjectSkills>>> {
  if (manifestState.needsProjectSkillMigration) {
    return prepareLegacyProjectSkills(projectRoot, sourceRoot);
  }
  await assertProjectSkillAdapters(projectRoot);
  return [];
}

function createUpgradedManifest(
  manifestState: InstallationManifestState,
  stagedRuntime: StagedRuntime,
): InstallationManifest {
  const { managedEntries, ...base } = manifestState.manifest;
  return {
    ...base,
    layoutVersion: CURRENT_LAYOUT_VERSION,
    runtime: {
      version: stagedRuntime.version,
      hash: stagedRuntime.hash,
      stateSchemaVersion: 1,
    },
    managedEntries: { ...managedEntries, codexSkill: true, claudeSkill: true },
  };
}

type UpgradeRollback = {
  manifestChanged: boolean;
  runtimeSwapped: boolean;
  projectSkillsChanged: boolean;
  managedChanged: boolean;
  assetsChanged: boolean;
};

async function rollbackUpgrade(
  state: UpgradeRollback,
  paths: HarnessPaths,
  previousManifest: string,
  previousCatalog: Buffer,
  runtimeBackupPath: string,
  projectRoot: string,
  projectSkills: Awaited<ReturnType<typeof prepareLegacyProjectSkills>>,
  managedUpdates: Awaited<ReturnType<typeof prepareManagedProjectFiles>>,
  assetChanges: readonly MaintainedAssetChange[],
): Promise<void> {
  if (state.manifestChanged) {
    await writeInstallationManifestAtomically(paths.installationPath, previousManifest);
  }
  if (state.runtimeSwapped) {
    await rm(paths.runtimeRoot, { recursive: true, force: true });
    await rename(runtimeBackupPath, paths.runtimeRoot);
  }
  if (state.projectSkillsChanged) {
    await restoreProjectSkillAdapters(projectRoot, projectSkills);
  }
  if (state.managedChanged) await restoreManagedProjectFiles(managedUpdates);
  if (state.assetsChanged) {
    await restoreMaintainedAssetChanges(assetChanges);
    await writeFile(paths.catalogPath, previousCatalog);
  }
}

async function upgradeHarnessProject(
  options: InstallHarnessProjectOptions,
  sourceRoot: string,
  projectRoot: string,
  paths: HarnessPaths,
): Promise<InstallHarnessProjectResult> {
  const manifestState = await assertCurrentInstallation(paths);
  const managedUpdates = await prepareManagedProjectFiles(projectRoot);
  const previousManifest = await readFile(paths.installationPath, "utf8");
  const previousCatalog = await readFile(paths.catalogPath);
  const temporaryRoot = await mkdtemp(join(projectRoot, ".harness-graph-runtime-"));
  const runtimeBackupPath = join(temporaryRoot, "runtime-backup");
  const state: UpgradeRollback = {
    manifestChanged: false,
    runtimeSwapped: false,
    projectSkillsChanged: false,
    managedChanged: false,
    assetsChanged: false,
  };
  let projectSkills: Awaited<ReturnType<typeof prepareLegacyProjectSkills>> = [];
  let assetChanges: MaintainedAssetChange[] = [];
  try {
    const runtime = await prepareRuntimeUpgrade(sourceRoot, temporaryRoot, paths, manifestState);
    assetChanges = options.overwriteMaintainedAssets === true
      ? await prepareMaintainedAssetChanges(sourceRoot, paths.harnessRoot)
      : [];
    if (assetChanges.length > 0 && await hasRecoverableRun(paths.stateRoot)) {
      throw new Error("项目存在运行中的 Run，不能覆盖 Workflow、Skill、Check 或 Model。");
    }
    projectSkills = await prepareUpgradeSkills(projectRoot, sourceRoot, manifestState);
    state.managedChanged = await writeManagedProjectFiles(managedUpdates);
    state.projectSkillsChanged = await writeProjectSkillAdapters(projectRoot, projectSkills);
    if (runtime.changed) {
      if (options.installRuntimeDependencies !== false) {
        await installRuntimeDependencies(runtime.staged.root);
      }
      await rename(paths.runtimeRoot, runtimeBackupPath);
      await rename(runtime.staged.root, paths.runtimeRoot);
      state.runtimeSwapped = true;
    }
    if (assetChanges.length > 0) {
      await writeMaintainedAssetChanges(assetChanges);
      state.assetsChanged = true;
      await activateWorkflowCatalog({ rootDir: paths.harnessRoot });
    }
    const upgradedManifest = createUpgradedManifest(manifestState, runtime.staged);
    if (options.overwriteMaintainedAssets === true) {
      upgradedManifest.harnessVersion = await readHarnessVersion(sourceRoot);
    }
    const nextManifest = `${JSON.stringify(upgradedManifest, null, 2)}\n`;
    if (nextManifest !== previousManifest) {
      await writeInstallationManifestAtomically(paths.installationPath, nextManifest);
      state.manifestChanged = true;
    }
    if (
      manifestState.needsProjectSkillMigration ||
      manifestState.needsLayoutMigration ||
      assetChanges.length > 0
    ) {
      await checkHarnessProject({ projectRoot });
    }
    const result: InstallHarnessProjectResult = {
      status: "installed",
      changed: Object.values(state).some(Boolean) || runtime.changed,
      projectRoot: ".",
      harnessRoot: "harness-graph",
      command: "./harness-graph/bin/harness-graph route",
      maintainedEntries: await maintainedEntryChanges(sourceRoot, paths.harnessRoot),
      overwrittenEntries: assetChanges.map((change) => change.displayPath),
    };
    if (state.runtimeSwapped) await rm(runtimeBackupPath, { recursive: true, force: true });
    return result;
  } catch (error: unknown) {
    await rollbackUpgrade(
      state,
      paths,
      previousManifest,
      previousCatalog,
      runtimeBackupPath,
      projectRoot,
      projectSkills,
      managedUpdates,
      assetChanges,
    );
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function createFreshManifest(
  sourceRoot: string,
  options: InstallHarnessProjectOptions,
  version: string,
  hash: string,
): Promise<InstallationManifest> {
  return {
    schemaVersion: 1,
    layoutVersion: CURRENT_LAYOUT_VERSION,
    harnessVersion: await readHarnessVersion(sourceRoot),
    installedAt: (options.now ?? (() => new Date()))().toISOString(),
    runtime: { version, hash, stateSchemaVersion: 1 },
    managedEntries: {
      agents: true,
      claude: true,
      gitignore: true,
      codexSkill: true,
      claudeSkill: true,
    },
  };
}

async function installFreshHarnessProject(
  options: InstallHarnessProjectOptions,
  sourceRoot: string,
  projectRoot: string,
  paths: HarnessPaths,
): Promise<InstallHarnessProjectResult> {
  const managedUpdates = await prepareManagedProjectFiles(projectRoot);
  const projectSkills = await prepareProjectSkillAdapters(projectRoot);
  const temporaryRoot = await mkdtemp(join(projectRoot, ".harness-graph-install-"));
  const stagedRoot = join(temporaryRoot, HARNESS_ROOT_DIRECTORY);
  let managedChanged = false;
  let projectSkillsChanged = false;
  let harnessInstalled = false;
  try {
    await mkdir(stagedRoot);
    await copyPayload(sourceRoot, stagedRoot);
    const runtimeRoot = join(stagedRoot, "runtime");
    const runtimePackage = await writeRuntimePackage(sourceRoot, join(runtimeRoot, "package.json"));
    await generateRuntimeLock(runtimeRoot);
    const runtimeHash = await hashRuntimeArtifacts(runtimeRoot);
    await writeLauncher(stagedRoot);
    if (options.installRuntimeDependencies !== false) await installRuntimeDependencies(runtimeRoot);
    const manifest = await createFreshManifest(
      sourceRoot,
      options,
      runtimePackage.version,
      runtimeHash,
    );
    await writeFile(
      join(stagedRoot, "installation.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await mkdir(join(stagedRoot, ".state/runs"), { recursive: true });
    await mkdir(join(stagedRoot, ".state/tmp"), { recursive: true });
    await activateWorkflowCatalog({ rootDir: stagedRoot });
    managedChanged = await writeManagedProjectFiles(managedUpdates);
    projectSkillsChanged = await writeProjectSkillAdapters(projectRoot, projectSkills);
    await rename(stagedRoot, paths.harnessRoot);
    harnessInstalled = true;
    await checkHarnessProject({ projectRoot });
  } catch (error: unknown) {
    if (harnessInstalled) await rm(paths.harnessRoot, { recursive: true, force: true });
    if (projectSkillsChanged) await restoreProjectSkillAdapters(projectRoot, projectSkills);
    if (managedChanged) await restoreManagedProjectFiles(managedUpdates);
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return {
    status: "installed",
    changed: true,
    projectRoot: ".",
    harnessRoot: "harness-graph",
    command: "./harness-graph/bin/harness-graph route",
    maintainedEntries: [],
    overwrittenEntries: [],
  };
}

export async function previewHarnessAssetChanges(
  options: PreviewHarnessAssetChangesOptions,
): Promise<MaintainedAssetPreview> {
  assertSupportedNodeVersion();
  const sourceRoot = resolve(options.sourceRoot);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const paths = resolveHarnessPaths({ projectRoot });
  if (!(await exists(paths.harnessRoot))) {
    throw new Error("项目尚未安装 Harness Graph；请先执行 install。");
  }
  await assertCurrentInstallation(paths);
  return renderMaintainedAssetPreview(
    await prepareMaintainedAssetChanges(sourceRoot, paths.harnessRoot),
  );
}

export async function installHarnessProject(
  options: InstallHarnessProjectOptions,
): Promise<InstallHarnessProjectResult> {
  assertSupportedNodeVersion();
  const sourceRoot = resolve(options.sourceRoot);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const paths = resolveHarnessPaths({ projectRoot });
  if (!(await stat(projectRoot)).isDirectory()) throw new Error("安装目标必须是本地目录。");
  await access(projectRoot, constants.R_OK | constants.W_OK);
  const legacyRoot = join(projectRoot, LEGACY_HARNESS_ROOT_DIRECTORY);
  const [hasCurrent, hasLegacy] = await Promise.all([
    exists(paths.harnessRoot),
    exists(legacyRoot),
  ]);
  if (hasCurrent && hasLegacy) {
    throw new Error("项目同时存在 harness-graph 和 harness-next，无法确定安装事实源。");
  }
  if (hasLegacy) {
    return migrateLegacyHarnessProject(options, sourceRoot, projectRoot, paths, legacyRoot);
  }
  if (hasCurrent) return upgradeHarnessProject(options, sourceRoot, projectRoot, paths);
  return installFreshHarnessProject(options, sourceRoot, projectRoot, paths);
}

export { checkHarnessProject, resolveHarnessPaths };
export type {
  CheckHarnessProjectOptions,
  CheckHarnessProjectResult,
  HarnessPaths,
  ResolveHarnessPathsOptions,
};

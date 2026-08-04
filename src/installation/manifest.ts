import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export type InstallationManifest = {
  schemaVersion: 1;
  layoutVersion: 1;
  harnessVersion: string;
  installedAt: string;
  runtime?: {
    version: string;
    hash: string;
    stateSchemaVersion: 1;
  };
  managedEntries: {
    agents: true;
    claude: true;
    gitignore: true;
    codexSkill?: true;
    claudeSkill?: true;
  };
};

export type InstallationManifestState = {
  manifest: InstallationManifest;
  needsProjectSkillMigration: boolean;
  needsRuntimeMigration: boolean;
};

export async function readInstallationManifest(
  path: string,
): Promise<InstallationManifestState> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const value = typeof parsed === "object" && parsed !== null
    ? parsed as Record<string, unknown>
    : {};
  const managed = typeof value.managedEntries === "object" && value.managedEntries !== null
    ? value.managedEntries as Record<string, unknown>
    : {};
  const hasProjectSkills = managed.codexSkill === true && managed.claudeSkill === true;
  const isLegacy = managed.codexSkill === undefined && managed.claudeSkill === undefined;
  const runtime = value.runtime;
  const hasRuntime = typeof runtime === "object" && runtime !== null && !Array.isArray(runtime);
  const runtimeRecord = hasRuntime ? runtime as Record<string, unknown> : {};
  const hasValidRuntime =
    typeof runtimeRecord.version === "string" && runtimeRecord.version.length > 0 &&
    typeof runtimeRecord.hash === "string" && /^[a-f0-9]{64}$/u.test(runtimeRecord.hash) &&
    runtimeRecord.stateSchemaVersion === 1;
  const isLegacyRuntime = runtime === undefined;
  if (
    value.schemaVersion !== 1 ||
    value.layoutVersion !== 1 ||
    typeof value.harnessVersion !== "string" ||
    typeof value.installedAt !== "string" ||
    managed.agents !== true ||
    managed.claude !== true ||
    managed.gitignore !== true ||
    (!hasProjectSkills && !isLegacy) ||
    (runtime !== undefined && (!hasRuntime || !hasValidRuntime))
  ) {
    throw new Error("现有 Harness Next 安装清单版本不受支持。");
  }
  return {
    manifest: {
      schemaVersion: 1,
      layoutVersion: 1,
      harnessVersion: value.harnessVersion,
      installedAt: value.installedAt,
      ...(hasValidRuntime
        ? {
            runtime: {
              version: runtimeRecord.version as string,
              hash: runtimeRecord.hash as string,
              stateSchemaVersion: 1 as const,
            },
          }
        : {}),
      managedEntries: {
        agents: true,
        claude: true,
        gitignore: true,
        ...(hasProjectSkills ? { codexSkill: true, claudeSkill: true } : {}),
      },
    },
    needsProjectSkillMigration: isLegacy,
    needsRuntimeMigration: isLegacyRuntime,
  };
}

export async function writeInstallationManifestAtomically(
  path: string,
  source: string,
): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

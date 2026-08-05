import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { CURRENT_LAYOUT_VERSION, LEGACY_LAYOUT_VERSION, PRODUCT_NAME } from "./layout.js";

export type InstallationManifest = {
  schemaVersion: 1;
  layoutVersion: typeof CURRENT_LAYOUT_VERSION;
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

export type ReadableInstallationManifest = Omit<InstallationManifest, "layoutVersion"> & {
  layoutVersion: typeof CURRENT_LAYOUT_VERSION | typeof LEGACY_LAYOUT_VERSION;
};

export type InstallationManifestState = {
  manifest: ReadableInstallationManifest;
  needsLayoutMigration: boolean;
  needsProjectSkillMigration: boolean;
  needsRuntimeMigration: boolean;
};

type ParsedRuntime = {
  runtime?: InstallationManifest["runtime"];
  needsMigration: boolean;
};

function unsupportedManifest(): Error {
  return new Error(`现有 ${PRODUCT_NAME} 安装清单版本不受支持。`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw unsupportedManifest();
  }
  return value as Record<string, unknown>;
}

function parseLayoutVersion(value: unknown): ReadableInstallationManifest["layoutVersion"] {
  if (value === CURRENT_LAYOUT_VERSION || value === LEGACY_LAYOUT_VERSION) return value;
  throw unsupportedManifest();
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw unsupportedManifest();
  return value;
}

function parseManagedEntries(value: unknown): {
  entries: InstallationManifest["managedEntries"];
  needsMigration: boolean;
} {
  const managed = asRecord(value);
  if (managed.agents !== true || managed.claude !== true || managed.gitignore !== true) {
    throw unsupportedManifest();
  }
  const hasSkills = managed.codexSkill === true && managed.claudeSkill === true;
  const hasNoSkills = managed.codexSkill === undefined && managed.claudeSkill === undefined;
  if (!hasSkills && !hasNoSkills) throw unsupportedManifest();
  return {
    entries: {
      agents: true,
      claude: true,
      gitignore: true,
      ...(hasSkills ? { codexSkill: true, claudeSkill: true } : {}),
    },
    needsMigration: hasNoSkills,
  };
}

function parseRuntime(value: unknown): ParsedRuntime {
  if (value === undefined) return { needsMigration: true };
  const runtime = asRecord(value);
  const version = requiredString(runtime.version);
  const hash = requiredString(runtime.hash);
  if (!/^[a-f0-9]{64}$/u.test(hash) || runtime.stateSchemaVersion !== 1) {
    throw unsupportedManifest();
  }
  return {
    runtime: { version, hash, stateSchemaVersion: 1 },
    needsMigration: false,
  };
}

export async function readInstallationManifest(
  path: string,
): Promise<InstallationManifestState> {
  const value = asRecord(JSON.parse(await readFile(path, "utf8")) as unknown);
  if (value.schemaVersion !== 1) throw unsupportedManifest();
  const layoutVersion = parseLayoutVersion(value.layoutVersion);
  const managed = parseManagedEntries(value.managedEntries);
  const runtime = parseRuntime(value.runtime);
  return {
    manifest: {
      schemaVersion: 1,
      layoutVersion,
      harnessVersion: requiredString(value.harnessVersion),
      installedAt: requiredString(value.installedAt),
      ...(runtime.runtime === undefined ? {} : { runtime: runtime.runtime }),
      managedEntries: managed.entries,
    },
    needsLayoutMigration: layoutVersion === LEGACY_LAYOUT_VERSION,
    needsProjectSkillMigration: managed.needsMigration,
    needsRuntimeMigration: runtime.needsMigration,
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

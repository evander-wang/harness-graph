import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { RUNTIME_ENTRIES } from "./runtime-installation.js";

const MAINTAINED_ENTRIES = [
  ["harness/workflows", "workflows"],
  ["harness/models", "models"],
  ["harness/checks", "checks"],
  ["harness/skills", "skills"],
  ["harness/workflow-activation.yaml", "workflow-activation.yaml"],
  ["harness/generated/workflow-catalog.json", "generated/workflow-catalog.json"],
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readHarnessVersion(sourceRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")) as unknown;
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error("Harness Graph package.json 缺少有效 version。");
  }
  return packageJson.version;
}

export async function copyPayload(sourceRoot: string, harnessRoot: string): Promise<void> {
  for (const [source, target] of [...RUNTIME_ENTRIES, ...MAINTAINED_ENTRIES]) {
    await cp(join(sourceRoot, source), join(harnessRoot, target), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

export type MaintainedAssetChange = {
  displayPath: string;
  targetPath: string;
  current: Buffer | null;
  next: Buffer;
};

export type MaintainedAssetPreview = {
  entries: string[];
  diff: string;
};

function displayLines(source: Buffer | null): string[] {
  if (source === null || source.length === 0) return [];
  const lines = source.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}

function renderAssetDiff(change: MaintainedAssetChange): string {
  const current = displayLines(change.current);
  const next = displayLines(change.next);
  const path = `harness-graph/${change.displayPath}`;
  return [
    `--- ${change.current === null ? "/dev/null" : `a/${path}`}`,
    `+++ b/${path}`,
    `@@ -1,${String(current.length)} +1,${String(next.length)} @@`,
    ...current.map((line) => `-${line}`),
    ...next.map((line) => `+${line}`),
  ].join("\n");
}

export async function prepareMaintainedAssetChanges(
  sourceRoot: string,
  harnessRoot: string,
): Promise<MaintainedAssetChange[]> {
  const changes: MaintainedAssetChange[] = [];
  const visit = async (sourcePath: string, targetPath: string, displayPath: string): Promise<void> => {
    const sourceStat = await stat(sourcePath);
    if (sourceStat.isDirectory()) {
      for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
        await visit(join(sourcePath, entry.name), join(targetPath, entry.name), join(displayPath, entry.name));
      }
      return;
    }
    const current = await exists(targetPath) ? await readFile(targetPath) : null;
    const next = await readFile(sourcePath);
    if (current === null || !current.equals(next)) {
      changes.push({
        displayPath: displayPath.split("\\").join("/"),
        targetPath,
        current,
        next,
      });
    }
  };
  for (const [source, target] of MAINTAINED_ENTRIES) {
    if (target !== "generated/workflow-catalog.json") {
      await visit(join(sourceRoot, source), join(harnessRoot, target), target);
    }
  }
  return changes;
}

export function renderMaintainedAssetPreview(
  changes: readonly MaintainedAssetChange[],
): MaintainedAssetPreview {
  return {
    entries: changes.map((change) => change.displayPath),
    diff: changes.map(renderAssetDiff).join("\n\n"),
  };
}

async function writeAtomically(path: string, source: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, source, { flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function restoreMaintainedAssetChanges(
  changes: readonly MaintainedAssetChange[],
): Promise<void> {
  for (const change of changes) {
    if (change.current === null) await rm(change.targetPath, { force: true });
    else await writeAtomically(change.targetPath, change.current);
  }
}

export async function writeMaintainedAssetChanges(
  changes: readonly MaintainedAssetChange[],
): Promise<void> {
  try {
    for (const change of changes) await writeAtomically(change.targetPath, change.next);
  } catch (error: unknown) {
    await restoreMaintainedAssetChanges(changes);
    throw error;
  }
}

export async function maintainedEntryChanges(
  sourceRoot: string,
  harnessRoot: string,
): Promise<string[]> {
  return (await prepareMaintainedAssetChanges(sourceRoot, harnessRoot))
    .map((change) => change.displayPath);
}

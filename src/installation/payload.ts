import { access, cp, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { RUNTIME_ENTRIES } from "./runtime-installation.js";

const MAINTAINED_ENTRIES = [
  ["harness/workflows", "workflows"],
  ["harness/models", "models"],
  ["harness/checks", "checks"],
  ["skills", "skills"],
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

export async function maintainedEntryChanges(
  sourceRoot: string,
  harnessRoot: string,
): Promise<string[]> {
  const changed: string[] = [];
  const visit = async (sourcePath: string, targetPath: string, displayPath: string): Promise<void> => {
    const sourceStat = await stat(sourcePath);
    if (sourceStat.isDirectory()) {
      for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
        await visit(join(sourcePath, entry.name), join(targetPath, entry.name), join(displayPath, entry.name));
      }
      return;
    }
    if (!(await exists(targetPath))) {
      changed.push(displayPath.split("\\").join("/"));
      return;
    }
    const [source, target] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
    if (!source.equals(target)) changed.push(displayPath.split("\\").join("/"));
  };
  for (const [source, target] of MAINTAINED_ENTRIES) {
    if (target !== "generated/workflow-catalog.json") {
      await visit(join(sourceRoot, source), join(harnessRoot, target), target);
    }
  }
  return changed;
}

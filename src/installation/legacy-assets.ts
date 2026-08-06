import { access, cp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import {
  HARNESS_ROOT_DIRECTORY,
  LEGACY_HARNESS_CLI_NAME,
  LEGACY_HARNESS_ROOT_DIRECTORY,
} from "./layout.js";

const PUBLISHED_TEXT_EXTENSIONS = new Set([".json", ".md", ".yaml", ".yml"]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function currentBrand(source: string): string {
  return source
    .replaceAll("Harness Next", "Harness Graph")
    .replaceAll("HARNESS_NEXT", "HARNESS_GRAPH")
    .replaceAll("harness-next", "harness-graph");
}

async function rewriteLegacyPublishedText(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const topLevel = relative(root, path).split(/[\\/]/u)[0];
    if (entry.isDirectory()) {
      if (topLevel !== ".state" && topLevel !== "runtime") {
        await rewriteLegacyPublishedText(root, path);
      }
      continue;
    }
    if (!entry.isFile() || !PUBLISHED_TEXT_EXTENSIONS.has(extname(entry.name))) continue;
    const source = await readFile(path, "utf8");
    const next = currentBrand(source);
    if (next !== source) await writeFile(path, next, "utf8");
  }
}

export async function stageLegacyPublishedAssets(
  sourceRoot: string,
  legacyHarnessRoot: string,
  stagedHarnessRoot: string,
): Promise<void> {
  await cp(legacyHarnessRoot, stagedHarnessRoot, {
    recursive: true,
    filter: (source) => {
      const relativePath = relative(legacyHarnessRoot, source);
      return relativePath === "" || relativePath.split(/[\\/]/u)[0] !== "runtime";
    },
  });
  await rm(join(stagedHarnessRoot, "bin", LEGACY_HARNESS_CLI_NAME), { force: true });
  const legacyCanonicalSkill = join(stagedHarnessRoot, "skills", LEGACY_HARNESS_ROOT_DIRECTORY);
  const canonicalSkill = join(stagedHarnessRoot, "skills", HARNESS_ROOT_DIRECTORY);
  if (await exists(legacyCanonicalSkill)) {
    if (await exists(canonicalSkill)) {
      throw new Error("旧安装同时包含 harness-next 和 harness-graph 规范入口 Skill。");
    }
    await rename(legacyCanonicalSkill, canonicalSkill);
  } else if (!(await exists(canonicalSkill))) {
    await cp(join(sourceRoot, "harness/skills", HARNESS_ROOT_DIRECTORY), canonicalSkill, { recursive: true });
  }
  await rewriteLegacyPublishedText(stagedHarnessRoot);
}

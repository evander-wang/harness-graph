import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { compileWorkflow } from "./compiler.js";
import { resolveHarnessLayout } from "./paths.js";

export type AssetNamingDiagnostic = {
  code: "ASSET_SCOPE" | "ASSET_NAME" | "ASSET_ID";
  message: string;
  path: string;
};

export const FIRST_PARTY_ASSET_PREFIXES = ["common-", "node-typescript-"] as const;
export const RESERVED_SKILL_IDS = new Set(["harness-graph", "workflow-router"]);

function hasKnownScope(id: string): boolean {
  return FIRST_PARTY_ASSET_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function scopedAsset(id: string, kind: string, path: string, diagnostics: AssetNamingDiagnostic[]): void {
  if (!hasKnownScope(id)) {
    diagnostics.push({
      code: "ASSET_SCOPE",
      message: `${kind} '${id}' 必须使用 common- 或 node-typescript- 作用域前缀。`,
      path,
    });
  }
}

async function directoryNames(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function checkSkill(layoutRoot: string, id: string, diagnostics: AssetNamingDiagnostic[]): Promise<void> {
  if (RESERVED_SKILL_IDS.has(id)) return;
  const path = join(layoutRoot, "harness/skills", id, "SKILL.md");
  scopedAsset(id, "Skill", path, diagnostics);
  try {
    const source = await readFile(path, "utf8");
    if (!new RegExp(`^---\\nname: ${id}\\n`, "u").test(source)) {
      diagnostics.push({ code: "ASSET_NAME", message: `Skill Front Matter name 必须与目录 '${id}' 一致。`, path });
    }
  } catch (error: unknown) {
    diagnostics.push({ code: "ASSET_ID", message: error instanceof Error ? error.message : String(error), path });
  }
}

async function checkCheck(layoutRoot: string, id: string, diagnostics: AssetNamingDiagnostic[]): Promise<void> {
  const path = join(layoutRoot, "harness/checks", id, "CHECK.md");
  scopedAsset(id, "Check", path, diagnostics);
  try {
    const source = await readFile(path, "utf8");
    if (!new RegExp(`(?:^|\\n)# ${id}(?:\\n|$)`, "u").test(source)) {
      diagnostics.push({ code: "ASSET_NAME", message: `Check 标题必须与目录 '${id}' 一致。`, path });
    }
  } catch (error: unknown) {
    diagnostics.push({ code: "ASSET_ID", message: error instanceof Error ? error.message : String(error), path });
  }
}

async function checkModel(layoutRoot: string, fileName: string, diagnostics: AssetNamingDiagnostic[]): Promise<void> {
  const path = join(layoutRoot, "harness/models", fileName);
  const id = fileName.replace(/\.schema\.json$/u, "");
  scopedAsset(id, "Model", path, diagnostics);
  try {
    const source = JSON.parse(await readFile(path, "utf8")) as { $id?: unknown };
    if (source.$id !== `harness://models/${fileName}`) {
      diagnostics.push({ code: "ASSET_ID", message: `Model $id 必须指向 harness://models/${fileName}。`, path });
    }
  } catch (error: unknown) {
    diagnostics.push({ code: "ASSET_ID", message: error instanceof Error ? error.message : String(error), path });
  }
}

export async function validatePublishedAssetNames(rootDir: string): Promise<AssetNamingDiagnostic[]> {
  const layout = resolveHarnessLayout(resolve(rootDir));
  const diagnostics: AssetNamingDiagnostic[] = [];
  let workflowIds: string[];
  let skillIds: string[];
  let checkIds: string[];
  let modelFiles: string[];
  try {
    [workflowIds, skillIds, checkIds, modelFiles] = await Promise.all([
      directoryNames(layout.workflowsRoot),
      directoryNames(layout.skillsRoot),
      directoryNames(layout.checksRoot),
      readdir(layout.modelsRoot).then((entries) => entries.filter((entry) => entry.endsWith(".schema.json")).sort()),
    ]);
  } catch (error: unknown) {
    return [{ code: "ASSET_ID", message: error instanceof Error ? error.message : String(error), path: layout.harnessRoot }];
  }

  for (const id of workflowIds) {
    const path = join(layout.workflowsRoot, id, "workflow.yaml");
    scopedAsset(id, "Workflow", path, diagnostics);
    try {
      const result = await compileWorkflow({ rootDir: layout.harnessRoot, workflowPath: path });
      if (result.workflow?.document.name !== id) {
        diagnostics.push({ code: "ASSET_NAME", message: `Workflow document.name 必须与目录 '${id}' 一致。`, path });
      }
    } catch (error: unknown) {
      diagnostics.push({ code: "ASSET_ID", message: error instanceof Error ? error.message : String(error), path });
    }
  }
  for (const id of skillIds) await checkSkill(layout.harnessRoot, id, diagnostics);
  for (const id of checkIds) await checkCheck(layout.harnessRoot, id, diagnostics);
  for (const fileName of modelFiles) await checkModel(layout.harnessRoot, fileName, diagnostics);
  return diagnostics;
}

export function isFirstPartyAssetRoot(rootDir: string): boolean {
  return resolve(rootDir) === resolve(import.meta.dirname, "../..");
}

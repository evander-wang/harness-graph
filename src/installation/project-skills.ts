import { mkdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PROJECT_SKILL_SOURCE = `---
name: harness-next
description: Run this project's installed Harness Next Workflow. Use when the user invokes harness-next, names a Workflow or Alias, asks to run or recover a Workflow, or requests a project code or configuration change.
---

Read \`../../../harness-next/skills/harness-next/SKILL.md\` completely and follow it for the current user request.
`;

const PROJECT_SKILL_PATHS = [
  ".agents/skills/harness-next/SKILL.md",
  ".claude/skills/harness-next/SKILL.md",
] as const;

export type ProjectSkillAdapterPlan = {
  path: string;
  displayPath: string;
  existed: boolean;
  source: string;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readOptionalFile(path: string, displayPath: string): Promise<string | null> {
  try {
    if (!(await stat(path)).isFile()) {
      throw new Error(`项目级 Skill 已存在且不受 Harness Next 管理：${displayPath}`);
    }
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function prepareProjectSkillAdapters(
  projectRoot: string,
): Promise<ProjectSkillAdapterPlan[]> {
  return Promise.all(
    PROJECT_SKILL_PATHS.map((displayPath) => prepareProjectSkillFile(
      join(projectRoot, displayPath),
      displayPath,
      PROJECT_SKILL_SOURCE,
    )),
  );
}

async function prepareProjectSkillFile(
  path: string,
  displayPath: string,
  source: string,
): Promise<ProjectSkillAdapterPlan> {
  const current = await readOptionalFile(path, displayPath);
  if (current !== null && current !== source) {
    throw new Error(`项目级 Skill 已存在且不受 Harness Next 管理：${displayPath}`);
  }
  return { path, displayPath, existed: current !== null, source };
}

export async function prepareLegacyProjectSkills(
  projectRoot: string,
  sourceRoot: string,
): Promise<ProjectSkillAdapterPlan[]> {
  const displayPath = "harness-next/skills/harness-next/SKILL.md";
  const canonicalSource = await readFile(join(sourceRoot, "skills/harness-next/SKILL.md"), "utf8");
  const canonical = await prepareProjectSkillFile(
    join(projectRoot, displayPath),
    displayPath,
    canonicalSource,
  );
  return [canonical, ...await prepareProjectSkillAdapters(projectRoot)];
}

async function removeEmptyParents(path: string, projectRoot: string): Promise<void> {
  let current = dirname(path);
  while (current !== projectRoot) {
    try {
      await rmdir(current);
    } catch (error: unknown) {
      if (
        isNodeError(error) &&
        (error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST")
      ) {
        return;
      }
      throw error;
    }
    current = dirname(current);
  }
}

export async function restoreProjectSkillAdapters(
  projectRoot: string,
  plans: readonly ProjectSkillAdapterPlan[],
): Promise<void> {
  for (const plan of plans) {
    if (plan.existed) continue;
    await rm(plan.path, { force: true });
    await removeEmptyParents(plan.path, projectRoot);
  }
}

export async function writeProjectSkillAdapters(
  projectRoot: string,
  plans: readonly ProjectSkillAdapterPlan[],
): Promise<boolean> {
  try {
    for (const plan of plans) {
      if (plan.existed) continue;
      await mkdir(dirname(plan.path), { recursive: true });
      await writeFile(plan.path, plan.source, { encoding: "utf8", flag: "wx" });
    }
  } catch (error: unknown) {
    await restoreProjectSkillAdapters(projectRoot, plans);
    throw error;
  }
  return plans.some((plan) => !plan.existed);
}

export async function assertProjectSkillAdapters(projectRoot: string): Promise<void> {
  const plans = await prepareProjectSkillAdapters(projectRoot);
  const missing = plans.find((plan) => !plan.existed);
  if (missing !== undefined) {
    throw new Error(`项目级 Skill 缺失：${missing.displayPath}`);
  }
}

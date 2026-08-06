import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { HARNESS_ROOT_DIRECTORY } from "./layout.js";

export type HarnessPaths = {
  projectRoot: string;
  workspaceRoot: string;
  harnessRoot: string;
  runtimeRoot: string;
  stateRoot: string;
  workflowsRoot: string;
  modelsRoot: string;
  checksRoot: string;
  skillsRoot: string;
  generatedRoot: string;
  catalogPath: string;
  activationPath: string;
  installationPath: string;
  installed: boolean;
};

export type ResolveHarnessPathsOptions = {
  projectRoot?: string;
  harnessRoot?: string;
  runtimeEntryPath?: string;
  developmentRoot?: string;
};

function installedPaths(projectRoot: string, harnessRoot: string): HarnessPaths {
  return {
    projectRoot,
    workspaceRoot: projectRoot,
    harnessRoot,
    runtimeRoot: join(harnessRoot, "runtime"),
    stateRoot: join(harnessRoot, ".state"),
    workflowsRoot: join(harnessRoot, "workflows"),
    modelsRoot: join(harnessRoot, "models"),
    checksRoot: join(harnessRoot, "checks"),
    skillsRoot: join(harnessRoot, "skills"),
    generatedRoot: join(harnessRoot, "generated"),
    catalogPath: join(harnessRoot, "generated/workflow-catalog.json"),
    activationPath: join(harnessRoot, "workflow-activation.yaml"),
    installationPath: join(harnessRoot, "installation.json"),
    installed: true,
  };
}

function developmentPaths(rootDir: string): HarnessPaths {
  const harnessAssetsRoot = join(rootDir, "harness");
  return {
    projectRoot: rootDir,
    workspaceRoot: rootDir,
    harnessRoot: rootDir,
    runtimeRoot: rootDir,
    stateRoot: join(rootDir, ".harness"),
    workflowsRoot: join(harnessAssetsRoot, "workflows"),
    modelsRoot: join(harnessAssetsRoot, "models"),
    checksRoot: join(harnessAssetsRoot, "checks"),
    skillsRoot: join(harnessAssetsRoot, "skills"),
    generatedRoot: join(harnessAssetsRoot, "generated"),
    catalogPath: join(harnessAssetsRoot, "generated/workflow-catalog.json"),
    activationPath: join(harnessAssetsRoot, "workflow-activation.yaml"),
    installationPath: join(rootDir, "installation.json"),
    installed: false,
  };
}

export function resolveHarnessPaths(options: ResolveHarnessPathsOptions): HarnessPaths {
  if (options.projectRoot !== undefined) {
    const projectRoot = resolve(options.projectRoot);
    return installedPaths(projectRoot, join(projectRoot, HARNESS_ROOT_DIRECTORY));
  }
  if (options.harnessRoot !== undefined) {
    const harnessRoot = resolve(options.harnessRoot);
    if (
      existsSync(join(harnessRoot, "installation.json")) ||
      (existsSync(join(harnessRoot, "workflows")) && existsSync(join(harnessRoot, "skills")))
    ) {
      return installedPaths(resolve(harnessRoot, ".."), harnessRoot);
    }
    return developmentPaths(harnessRoot);
  }
  if (options.runtimeEntryPath !== undefined) {
    const runtimeEntryPath = resolve(options.runtimeEntryPath);
    const runtimeRoot = resolve(dirname(runtimeEntryPath), "..");
    if (basename(runtimeRoot) === "runtime") {
      const harnessRoot = resolve(runtimeRoot, "..");
      return installedPaths(resolve(harnessRoot, ".."), harnessRoot);
    }
  }
  return developmentPaths(resolve(options.developmentRoot ?? "."));
}

import { resolveHarnessPaths } from "../installation/paths.js";

export type HarnessLayout = {
  installed: boolean;
  harnessRoot: string;
  workspaceRoot: string;
  stateRoot: string;
  workflowsRoot: string;
  modelsRoot: string;
  checksRoot: string;
  skillsRoot: string;
  catalogPath: string;
  activationPath: string;
};

export function resolveHarnessLayout(rootDir: string): HarnessLayout {
  const paths = resolveHarnessPaths({ harnessRoot: rootDir });
  return {
    installed: paths.installed,
    harnessRoot: paths.harnessRoot,
    workspaceRoot: paths.workspaceRoot,
    stateRoot: paths.stateRoot,
    workflowsRoot: paths.workflowsRoot,
    modelsRoot: paths.modelsRoot,
    checksRoot: paths.checksRoot,
    skillsRoot: paths.skillsRoot,
    catalogPath: paths.catalogPath,
    activationPath: paths.activationPath,
  };
}

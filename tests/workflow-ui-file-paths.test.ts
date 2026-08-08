import { filesForStep } from "../web/file-paths.js";
import { describe, expect, test } from "vitest";

type UiDetail = Parameters<typeof filesForStep>[0];
type UiStep = Parameters<typeof filesForStep>[1];

function detail(catalogPath: string): UiDetail {
  return {
    catalog: { name: "node-typescript-development", path: catalogPath },
    files: [
      { path: `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}workflows/node-typescript-development/workflow.yaml`, kind: "workflow" },
      { path: `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}skills/node-typescript-analyze-change/SKILL.md`, kind: "skill" },
      { path: `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}checks/common-change-plan-ready/CHECK.md`, kind: "check" },
      { path: `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}workflows/common-change-execution-policy/workflow.yaml`, kind: "workflow" },
      { path: `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}skills/common-load-change-execution-policy/SKILL.md`, kind: "skill" },
    ],
  };
}

const currentStep: UiStep = {
  workflowName: "node-typescript-development",
  call: "node-typescript-analyze-change",
  checks: ["common-change-plan-ready"],
};

describe("Workflow UI Step file paths", () => {
  test.each([
    ["source", "harness/workflows/node-typescript-development/workflow.yaml"],
    ["installed", "workflows/node-typescript-development/workflow.yaml"],
  ])("matches the current Workflow Skill and Check in the %s layout", (_layout, catalogPath) => {
    const matched = filesForStep(detail(catalogPath), currentStep);

    expect(matched.map((file) => file.path)).toEqual([
      `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}workflows/node-typescript-development/workflow.yaml`,
      `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}skills/node-typescript-analyze-change/SKILL.md`,
      `${catalogPath.slice(0, catalogPath.indexOf("workflows"))}checks/common-change-plan-ready/CHECK.md`,
    ]);
  });

  test("matches prerequisite Workflow files in the installed layout", () => {
    const installedDetail = detail("workflows/node-typescript-development/workflow.yaml");
    const matched = filesForStep(installedDetail, {
      workflowName: "common-change-execution-policy",
      call: "common-load-change-execution-policy",
      checks: [],
    });

    expect(matched.map((file) => file.path)).toEqual([
      "workflows/common-change-execution-policy/workflow.yaml",
      "skills/common-load-change-execution-policy/SKILL.md",
    ]);
  });
});

import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { executeDeterministicChecks } from "../src/workflow/checks.js";
import { syncWorkflowCatalog } from "../src/workflow/catalog.js";
import { startWorkflowRun } from "../src/workflow/runtime.js";

async function createInstalledLayout(): Promise<{
  projectRoot: string;
  harnessRoot: string;
  workflowPath: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "harness-next-installed-"));
  const harnessRoot = join(projectRoot, "harness-next");
  const workflowPath = join(harnessRoot, "workflows/example/workflow.yaml");
  await mkdir(join(harnessRoot, "workflows/example"), { recursive: true });
  await mkdir(join(harnessRoot, "models"), { recursive: true });
  await mkdir(join(harnessRoot, "checks/cwd-check"), { recursive: true });
  await mkdir(join(harnessRoot, "skills/run-example"), { recursive: true });
  await mkdir(join(harnessRoot, "runtime"), { recursive: true });
  await writeFile(
    join(harnessRoot, "installation.json"),
    JSON.stringify({ schemaVersion: 1, layoutVersion: 1 }),
  );
  await writeFile(join(harnessRoot, "skills/run-example/SKILL.md"), "# Skill\n");
  await writeFile(
    join(harnessRoot, "models/request.schema.json"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["request"],
      properties: { request: { type: "string" } },
      additionalProperties: false,
    }),
  );
  await writeFile(
    workflowPath,
    `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: installed-example
  version: "1.0.0"
input:
  schema:
    resource:
      endpoint: harness://models/request.schema.json
do:
  - run-example:
      call: run-example
      then: end
`,
  );
  return { projectRoot, harnessRoot, workflowPath };
}

describe("installed Harness layout", () => {
  test("Catalog、Skill 和 Model 都从 Harness Root 解析", async () => {
    const { harnessRoot } = await createInstalledLayout();

    const result = await syncWorkflowCatalog({ rootDir: harnessRoot });
    const started = await startWorkflowRun({
      rootDir: harnessRoot,
      workflowPath: "workflows/example/workflow.yaml",
      executionKey: "installed-layout",
      input: { request: "实现功能" },
    });

    expect(result.catalog.workflows).toEqual([
      expect.objectContaining({
        name: "installed-example",
        path: "workflows/example/workflow.yaml",
      }),
    ]);
    expect(started.step?.skillPath).toBe("harness-next/skills/run-example/SKILL.md");
    await expect(
      readFile(join(harnessRoot, ".state/runs", started.runId, "state.json"), "utf8"),
    ).resolves.toContain('"workspaceRoot"');
  });

  test("Check 的 harness 和 workspace cwd 指向不同 Root 并传递 Workspace 环境", async () => {
    const { projectRoot, harnessRoot } = await createInstalledLayout();
    const checkSource = `---
commands:
  - command: node
    args:
      - -e
      - ${JSON.stringify("require('node:fs').writeFileSync('harness-cwd.txt', process.cwd())")}
    cwd: harness
  - command: node
    args:
      - -e
      - ${JSON.stringify("require('node:fs').writeFileSync('workspace-cwd.txt', process.env.HARNESS_WORKSPACE_ROOT ?? '')")}
    cwd: workspace
---
# cwd check
`;
    await writeFile(join(harnessRoot, "checks/cwd-check/CHECK.md"), checkSource);

    const executions = await executeDeterministicChecks({
      rootDir: harnessRoot,
      checkIds: ["cwd-check"],
    });

    expect(executions.map((execution) => execution.cwd)).toEqual(["harness", "workspace"]);
    expect(await readFile(join(harnessRoot, "harness-cwd.txt"), "utf8")).toBe(
      await realpath(harnessRoot),
    );
    await expect(readFile(join(projectRoot, "workspace-cwd.txt"), "utf8")).resolves.toBe(
      projectRoot,
    );
  });
});

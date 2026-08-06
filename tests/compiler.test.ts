import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { compileWorkflow } from "../src/workflow/compiler.js";

async function createValidProject(): Promise<{ rootDir: string; workflowPath: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), "harness-graph-"));
  const workflowPath = join(rootDir, "harness/workflows/example-workflow/workflow.yaml");

  await mkdir(join(rootDir, "harness/workflows/example-workflow"), { recursive: true });
  await mkdir(join(rootDir, "harness/checks/example-check"), { recursive: true });
  await mkdir(join(rootDir, "harness/skills/run-example"), { recursive: true });
  await writeFile(join(rootDir, "harness/checks/example-check/CHECK.md"), "# 验收\n");
  await writeFile(join(rootDir, "harness/skills/run-example/SKILL.md"), "# 执行示例\n");
  await writeFile(
    workflowPath,
    `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: example-workflow
  version: "0.1.0"
do:
  - run-example:
      call: run-example
      metadata:
        harness:
          checks:
            - example-check
      then: end
`,
  );

  return { rootDir, workflowPath };
}

describe("compileWorkflow", () => {
  test("项目配置 Workflow 包含完整执行与回改流程", async () => {
    const rootDir = resolve(import.meta.dirname, "..");
    const workflowPath = join(
      rootDir,
      "harness/workflows/node-project-configuration/workflow.yaml",
    );

    const result = await compileWorkflow({ rootDir, workflowPath });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.workflow?.do.map((item) => Object.keys(item)[0]),
    ).toEqual([
      "analyze-project",
      "decide-plan",
      "configure-project",
      "verify-project",
      "decide-quality",
      "review-project",
      "decide-review",
      "deliver-project",
    ]);
    expect(result.mermaid).toContain("analyze-project");
    expect(result.mermaid).toContain("deliver-project");
  });

  test("读取标准 Workflow 并生成 Mermaid", async () => {
    const project = await createValidProject();

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.mermaid).toContain("run-example");
  });

  test("报告不存在的 Skill 和 Check", async () => {
    const project = await createValidProject();
    await unlink(join(project.rootDir, "harness/skills/run-example/SKILL.md"));
    await unlink(join(project.rootDir, "harness/checks/example-check/CHECK.md"));

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "skill.not-found",
      "check.not-found",
    ]);
  });

  test("开发态不会把根目录 skills 作为 Skill 事实源", async () => {
    const project = await createValidProject();
    await unlink(join(project.rootDir, "harness/skills/run-example/SKILL.md"));
    await mkdir(join(project.rootDir, "skills/run-example"), { recursive: true });
    await writeFile(join(project.rootDir, "skills/run-example/SKILL.md"), "# 旧路径\n");

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "skill.not-found",
      message: "Step 'run-example' 引用的 Skill 不存在：harness/skills/run-example/SKILL.md",
    });
  });

  test("报告从起点无法到达的 Step", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: unreachable-step
  version: "0.1.0"
do:
  - start:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
      then: end
  - never-runs:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "workflow.unreachable-step",
      message: "Step 'never-runs' 无法从 Workflow 起点到达。",
    });
  });

  test("报告无法到达结束节点的 Cycle", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: no-terminal-path
  version: "0.1.0"
do:
  - revise:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
      then: review
  - review:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
      then: revise
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "workflow.no-terminal-path",
    );
  });

  test("固定流转的 Skill Step 可以没有输入、输出和 Check", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: skill-playbook
  version: "0.1.0"
do:
  - run-example:
      call: run-example
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("进入 switch 前的 Skill Step 必须绑定 Check", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: unchecked-branch
  version: "0.1.0"
do:
  - inspect:
      call: run-example
  - decide:
      switch:
        - passed:
            when: .status == "passed"
            then: finish
        - default:
            then: end
  - finish:
      call: run-example
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "check.required-before-switch",
      message: "Step 'inspect' 进入 switch 前必须绑定至少一个 Check。",
    });
  });

  test("拒绝远程调用 Task", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: remote-call
  version: "0.1.0"
do:
  - fetch-remote:
      call: http
      with:
        method: get
        endpoint: https://example.com
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("task.unsupported");
  });

  test("允许带退出路径的分支和回改 Cycle", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: review-cycle
  version: "0.1.0"
do:
  - prepare:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
  - decide:
      switch:
        - passed:
            when: .status == "passed"
            then: finish
        - needs-changes:
            then: revise
  - revise:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
      then: decide
  - finish:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("拒绝定时调度配置", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: scheduled-workflow
  version: "0.1.0"
schedule:
  cron: 0 0 * * *
do:
  - run:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "workflow.unsupported-feature",
    );
  });

  test("拒绝首版没有执行语义的 Task 类型", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: unsupported-task
  version: "0.1.0"
do:
  - assign-value:
      set:
        status: ready
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("task.unsupported");
  });

  test("拒绝 Runtime 不支持的 switch 条件", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: unsupported-condition
  version: "0.1.0"
do:
  - inspect:
      call: run-example
      metadata:
        harness:
          checks: [example-check]
  - decide:
      switch:
        - high-score:
            when: .score > 10
            then: end
        - default:
            then: inspect
`,
    );

    const result = await compileWorkflow(project);

    expect(result.diagnostics).toContainEqual({
      code: "switch.unsupported-condition",
      message: "Step 'decide' 使用了 Runtime 不支持的条件：.score > 10",
    });
  });

  test("拒绝非法的最大 Step 尝试次数", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: invalid-attempts
  version: "0.1.0"
  metadata:
    harness:
      execution:
        maxStepAttempts: 0
do:
  - inspect:
      call: run-example
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.diagnostics).toContainEqual({
      code: "execution.invalid-max-attempts",
      message: "document.metadata.harness.execution.maxStepAttempts 必须是正整数。",
    });
  });
});

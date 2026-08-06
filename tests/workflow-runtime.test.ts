import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  cancelWorkflowRun,
  continueWorkflowRun,
  startWorkflowRun,
  type StepResult,
  type WorkflowRuntimeResponse,
} from "../src/workflow/runtime.js";
import { expectGolden } from "./helpers/golden.js";

async function createRuntimeProject(options?: { failingQualityGate?: boolean }): Promise<{
  rootDir: string;
  workflowPath: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), "harness-runtime-"));
  const workflowPath = join(rootDir, "harness/workflows/runtime/workflow.yaml");
  await mkdir(join(rootDir, "harness/workflows/runtime"), { recursive: true });
  await mkdir(join(rootDir, "harness/models"), { recursive: true });

  for (const skillId of ["inspect-change", "implement-change", "verify-change", "deliver-change"]) {
    await mkdir(join(rootDir, "harness/skills", skillId), { recursive: true });
    await writeFile(join(rootDir, "harness/skills", skillId, "SKILL.md"), `# ${skillId}\n`);
  }
  for (const checkId of ["plan-ready", "quality-gate"]) {
    await mkdir(join(rootDir, "harness/checks", checkId), { recursive: true });
  }
  await writeFile(join(rootDir, "harness/checks/plan-ready/CHECK.md"), "# Plan Ready\n");
  await writeFile(
    join(rootDir, "harness/checks/quality-gate/CHECK.md"),
    `---
commands:
  - command: node
    args: ["-e", "process.exit(${options?.failingQualityGate === true ? "1" : "0"})"]
---
# Quality Gate
`,
  );
  await writeFile(
    join(rootDir, "harness/models/request.schema.json"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["title"],
      properties: { title: { type: "string", minLength: 1 } },
      additionalProperties: false,
    }),
  );
  await writeFile(
    join(rootDir, "harness/models/result.schema.json"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["status"],
      properties: { status: { const: "done" } },
      additionalProperties: false,
    }),
  );
  await writeFile(
    workflowPath,
    `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: runtime-test
  version: "0.1.0"
  metadata:
    harness:
      execution:
        maxStepAttempts: 2
input:
  schema:
    resource:
      endpoint: harness://models/request.schema.json
do:
  - inspect-change:
      call: inspect-change
      metadata:
        harness:
          checks: [plan-ready]
  - decide-plan:
      switch:
        - passed:
            when: .status == "passed"
            then: implement-change
        - needs-changes:
            then: inspect-change
  - implement-change:
      call: implement-change
  - verify-change:
      call: verify-change
      metadata:
        harness:
          checks: [quality-gate]
  - decide-quality:
      switch:
        - passed:
            when: .status == "passed"
            then: deliver-change
        - needs-changes:
            then: implement-change
  - deliver-change:
      call: deliver-change
      then: end
output:
  schema:
    resource:
      endpoint: harness://models/result.schema.json
`,
  );
  return { rootDir, workflowPath };
}

function resultFor(
  directive: WorkflowRuntimeResponse,
  status: StepResult["status"],
  data?: unknown,
): StepResult {
  if (directive.step === undefined) {
    throw new Error("测试期望 Runtime 返回当前 Step");
  }
  return {
    runId: directive.runId,
    revision: directive.revision,
    stepId: directive.step.id,
    status,
    evidence: [`${directive.step.id}:${status}`],
    ...(data === undefined ? {} : { data }),
  };
}

describe("Local Workflow Runtime", () => {
  test("Golden 锁定回改 Cycle、Check 和完成 Transition", async () => {
    const project = await createRuntimeProject();
    const firstInspect = await startWorkflowRun({
      ...project,
      executionKey: "golden-cycle",
      input: { title: "Golden Runtime" },
    });
    const secondInspect = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: firstInspect.runId,
      result: resultFor(firstInspect, "needs_changes"),
    });
    const implement = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: secondInspect.runId,
      result: resultFor(secondInspect, "passed"),
    });
    const verify = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: implement.runId,
      result: resultFor(implement, "passed"),
    });
    const deliver = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: verify.runId,
      result: resultFor(verify, "passed"),
    });
    const completed = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: deliver.runId,
      result: resultFor(deliver, "passed", { status: "done" }),
    });
    const state = JSON.parse(
      await readFile(join(project.rootDir, ".harness/runs", completed.runId, "state.json"), "utf8"),
    ) as { attempts?: unknown; status?: unknown; revision?: unknown; output?: unknown; executionTrace?: unknown[] };
    const trace = (state.executionTrace ?? []).map((entry) => {
      const record = entry as Record<string, unknown>;
      const stable = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== "at" && key !== "checkExecutions"),
      );
      const checkExecutions = record.checkExecutions;
      return {
        ...stable,
        ...(Array.isArray(checkExecutions)
          ? {
              checkExecutions: checkExecutions.map((check) => {
                const record = check as Record<string, unknown>;
                return {
                  checkId: record.checkId,
                  cwd: record.cwd,
                  exitCode: record.exitCode,
                };
              }),
            }
          : {}),
      };
    });

    await expectGolden(
      join(resolve(import.meta.dirname, ".."), "tests/fixtures/runtime-transitions.golden.json"),
      {
        status: state.status,
        revision: state.revision,
        attempts: state.attempts,
        output: state.output,
        trace,
      },
    );
  });

  test("start 校验输入、固定 Workflow 并返回首个 Step", async () => {
    const project = await createRuntimeProject();

    await expect(
      startWorkflowRun({
        ...project,
        executionKey: "task-invalid",
        input: {},
      }),
    ).rejects.toThrow("Workflow input 不符合 JSON Schema");

    const started = await startWorkflowRun({
      ...project,
      executionKey: "task-1",
      input: { title: "实现 Runtime" },
    });
    const statePath = join(project.rootDir, ".harness/runs", started.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;

    expect(started).toMatchObject({
      status: "running",
      revision: 1,
      step: {
        id: "inspect-change",
        attempt: 1,
        skillPath: "harness/skills/inspect-change/SKILL.md",
        checkPaths: ["harness/checks/plan-ready/CHECK.md"],
      },
    });
    expect(state).toMatchObject({
      executionKey: "task-1",
      workflowName: "runtime-test",
      workflowVersion: "0.1.0",
      revision: 1,
      status: "running",
    });
    expect(state.workflowHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(state).not.toHaveProperty("input");
    const executionTrace = state.executionTrace as Array<Record<string, unknown>>;
    expect(executionTrace).toHaveLength(1);
    expect(executionTrace[0]).toMatchObject({
      type: "step_started",
      stepId: "inspect-change",
      attempt: 1,
      revision: 1,
    });
    expect(typeof executionTrace[0]?.at).toBe("string");
  });

  test("Runtime 将确定性 Check 定向到目标项目目录", async () => {
    const project = await createRuntimeProject();
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-target-project-"));
    await writeFile(join(workspaceRoot, "target.marker"), "workspace\n");
    await writeFile(
      join(project.rootDir, "harness/checks/quality-gate/CHECK.md"),
      `---
commands:
  - command: node
    args: ["-e", "process.exit(require('node:fs').existsSync('target.marker') ? 0 : 1)"]
    cwd: workspace
---
# Quality Gate
`,
    );
    const inspect = await startWorkflowRun({
      ...project,
      workspaceRoot,
      executionKey: "task-workspace",
      input: { title: "目标目录" },
    });
    const implement = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: inspect.runId,
      result: resultFor(inspect, "passed"),
    });
    const verify = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: implement.runId,
      result: resultFor(implement, "passed"),
    });
    const deliver = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: verify.runId,
      result: resultFor(verify, "passed"),
    });
    const statePath = join(project.rootDir, ".harness/runs", inspect.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;

    expect(deliver.step?.id).toBe("deliver-change");
    expect(deliver.checkExecutions?.[0]).toMatchObject({ cwd: "workspace", exitCode: 0 });
    expect(state.workspaceRoot).toBe(workspaceRoot);
  });

  test("start 对 executionKey 幂等，并阻止同 Worktree 的第二个活动 Run", async () => {
    const project = await createRuntimeProject();
    const started = await startWorkflowRun({
      ...project,
      executionKey: "task-1",
      input: { title: "任务一" },
    });

    const resumed = await startWorkflowRun({
      ...project,
      executionKey: "task-1",
      input: { title: "任务一" },
    });
    expect(resumed).toMatchObject({
      runId: started.runId,
      status: "interrupted",
      revision: started.revision,
      step: started.step,
    });

    await expect(
      startWorkflowRun({
        ...project,
        executionKey: "task-2",
        input: { title: "任务二" },
      }),
    ).rejects.toThrow("当前 Worktree 已存在运行中的 Workflow");
  });

  test("同一 executionKey 不允许切换 Workflow 输入", async () => {
    const project = await createRuntimeProject();
    await startWorkflowRun({
      ...project,
      executionKey: "task-stable",
      input: { title: "原始任务" },
    });

    await expect(
      startWorkflowRun({
        ...project,
        executionKey: "task-stable",
        input: { title: "另一个任务" },
      }),
    ).rejects.toThrow("executionKey 已绑定到不同的 Workflow 或输入");
  });

  test("并发 start 只允许创建一个活动 Run", async () => {
    const project = await createRuntimeProject();
    const results = await Promise.allSettled([
      startWorkflowRun({
        ...project,
        executionKey: "concurrent-one",
        input: { title: "并发一" },
      }),
      startWorkflowRun({
        ...project,
        executionKey: "concurrent-two",
        input: { title: "并发二" },
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  test("自动回收已经退出进程遗留的 Runtime 锁", async () => {
    const project = await createRuntimeProject();
    const lockDirectory = join(project.rootDir, ".harness/runtime.lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      join(lockDirectory, "owner.json"),
      `${JSON.stringify({ pid: 999_999_999 })}\n`,
    );

    const started = await startWorkflowRun({
      ...project,
      executionKey: "stale-lock",
      input: { title: "回收遗留锁" },
    });

    expect(started).toMatchObject({ status: "running", step: { id: "inspect-change" } });
  });

  test("continue 校验 Revision 并按 switch 推进或阻塞", async () => {
    const project = await createRuntimeProject();
    const started = await startWorkflowRun({
      ...project,
      executionKey: "task-1",
      input: { title: "推进流程" },
    });

    await expect(
      continueWorkflowRun({
        rootDir: project.rootDir,
        runId: started.runId,
        result: { ...resultFor(started, "passed"), revision: 99 },
      }),
    ).rejects.toThrow("Step Result Revision 已过期");

    await expect(
      continueWorkflowRun({
        rootDir: project.rootDir,
        runId: started.runId,
        result: {
          ...resultFor(started, "passed"),
          evidence: [123] as unknown as string[],
        },
      }),
    ).rejects.toThrow("Step Result evidence 必须是非空字符串数组");

    const implement = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: started.runId,
      result: resultFor(started, "passed"),
    });
    expect(implement).toMatchObject({
      status: "running",
      revision: 2,
      step: { id: "implement-change", attempt: 1 },
    });

    const blocked = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: implement.runId,
      result: resultFor(implement, "blocked"),
    });
    expect(blocked).toMatchObject({ status: "blocked", revision: 3 });
    expect(blocked).not.toHaveProperty("step");
  });

  test("Cycle 超过最大尝试次数后阻塞", async () => {
    const project = await createRuntimeProject();
    const first = await startWorkflowRun({
      ...project,
      executionKey: "task-cycle",
      input: { title: "循环流程" },
    });
    const second = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: first.runId,
      result: resultFor(first, "needs_changes"),
    });
    expect(second).toMatchObject({
      status: "running",
      step: { id: "inspect-change", attempt: 2 },
    });

    const exhausted = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: second.runId,
      result: resultFor(second, "needs_changes"),
    });
    expect(exhausted).toMatchObject({ status: "blocked", revision: 3 });
    expect(exhausted.evidence).toContain("Step 'inspect-change' 超过最大尝试次数 2。");
  });

  test("确定性 Check 失败时返回返工 Step", async () => {
    const project = await createRuntimeProject({ failingQualityGate: true });
    const inspect = await startWorkflowRun({
      ...project,
      executionKey: "task-quality",
      input: { title: "质量门禁" },
    });
    const implement = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: inspect.runId,
      result: resultFor(inspect, "passed"),
    });
    const verify = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: implement.runId,
      result: resultFor(implement, "passed"),
    });
    expect(verify.step?.id).toBe("verify-change");

    const returned = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: verify.runId,
      result: resultFor(verify, "passed"),
    });

    expect(returned).toMatchObject({
      status: "running",
      step: { id: "implement-change", attempt: 2 },
    });
    expect(returned.checkExecutions).toHaveLength(1);
    expect(returned.checkExecutions?.[0]).toMatchObject({
      checkId: "quality-gate",
      exitCode: 1,
    });
  });

  test("Workflow 改变后拒绝继续，cancel 后不能推进", async () => {
    const changedProject = await createRuntimeProject();
    const changedRun = await startWorkflowRun({
      ...changedProject,
      executionKey: "task-change",
      input: { title: "变更检测" },
    });
    await writeFile(changedProject.workflowPath, `${await readFile(changedProject.workflowPath, "utf8")}\n`);

    await expect(
      continueWorkflowRun({
        rootDir: changedProject.rootDir,
        runId: changedRun.runId,
        result: resultFor(changedRun, "passed"),
      }),
    ).rejects.toThrow("Workflow 文件已在运行期间改变");

    const cancelledProject = await createRuntimeProject();
    const cancellable = await startWorkflowRun({
      ...cancelledProject,
      executionKey: "task-cancel",
      input: { title: "取消流程" },
    });
    const cancelled = await cancelWorkflowRun({
      rootDir: cancelledProject.rootDir,
      runId: cancellable.runId,
      reason: "用户取消",
    });
    expect(cancelled).toMatchObject({ status: "cancelled", revision: 2 });
    await expect(
      continueWorkflowRun({
        rootDir: cancelledProject.rootDir,
        runId: cancellable.runId,
        result: resultFor(cancellable, "passed"),
      }),
    ).rejects.toThrow("Workflow Run 已结束：cancelled");
  });

  test("完成时校验 Workflow Output Schema", async () => {
    const project = await createRuntimeProject();
    const inspect = await startWorkflowRun({
      ...project,
      executionKey: "task-output",
      input: { title: "输出校验" },
    });
    const implement = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: inspect.runId,
      result: resultFor(inspect, "passed"),
    });
    const verify = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: implement.runId,
      result: resultFor(implement, "passed"),
    });
    const deliver = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: verify.runId,
      result: resultFor(verify, "passed"),
    });
    expect(deliver.step?.id).toBe("deliver-change");

    await expect(
      continueWorkflowRun({
        rootDir: project.rootDir,
        runId: deliver.runId,
        result: resultFor(deliver, "passed", { status: "pending" }),
      }),
    ).rejects.toThrow("Workflow output 不符合 JSON Schema");

    const completed = await continueWorkflowRun({
      rootDir: project.rootDir,
      runId: deliver.runId,
      result: resultFor(deliver, "passed", { status: "done" }),
    });
    expect(completed).toMatchObject({
      status: "completed",
      revision: 5,
      output: { status: "done" },
    });
    const state = JSON.parse(
      await readFile(join(project.rootDir, ".harness/runs", completed.runId, "state.json"), "utf8"),
    ) as { executionTrace?: { type: string; stepId?: string; toStepId?: string | null }[] };
    expect(state.executionTrace?.filter((entry) => entry.type === "step_started").map((entry) => entry.stepId)).toEqual([
      "inspect-change",
      "implement-change",
      "verify-change",
      "deliver-change",
    ]);
    expect(state.executionTrace?.filter((entry) => entry.type === "transition").at(-1)).toMatchObject({
      fromStepId: "deliver-change",
      toStepId: null,
    });
    expect(state.executionTrace?.at(-1)?.type).toBe("workflow_completed");
  });
});

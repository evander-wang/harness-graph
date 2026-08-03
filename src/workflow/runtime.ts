import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { Specification } from "@openworkflowspec/sdk";

import {
  executeDeterministicChecks,
  type CheckCommandExecution,
} from "./checks.js";
import { compileWorkflow, validateWorkflowData } from "./compiler.js";
import { resolveHarnessLayout } from "./paths.js";
import {
  parseRunState,
  type WorkflowRunState,
  type WorkflowStepDirective,
} from "./run-state.js";
import {
  readAllRunStates,
  readRunState,
  withRuntimeLock,
  writeRunState,
} from "./runtime-state.js";
import {
  findTask,
  resolveNextStep,
  taskEntries,
  type TaskEntry,
} from "./runtime-transition.js";

export type StepResultStatus = "passed" | "needs_changes" | "blocked";

export type StepResult = {
  runId: string;
  revision: number;
  stepId: string;
  status: StepResultStatus;
  evidence: string[];
  data?: unknown;
};

export type { WorkflowStepDirective } from "./run-state.js";

export type WorkflowRunStatus =
  | "running"
  | "interrupted"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export type WorkflowRuntimeResponse = {
  runId: string;
  status: WorkflowRunStatus;
  revision: number;
  step?: WorkflowStepDirective;
  evidence?: string[];
  output?: unknown;
  checkExecutions?: CheckCommandExecution[];
};

export type StartWorkflowRunOptions = {
  rootDir: string;
  workspaceRoot?: string;
  workflowPath: string;
  executionKey: string;
  input: unknown;
};

export type ContinueWorkflowRunOptions = {
  rootDir: string;
  runId: string;
  result?: StepResult;
};

export type CancelWorkflowRunOptions = {
  rootDir: string;
  runId: string;
  reason: string;
};

type LoadedWorkflow = {
  workflow: Specification.Workflow;
  workflowPath: string;
  workflowHash: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isInsideWorkspace(rootDir: string, path: string): boolean {
  return path === rootDir || path.startsWith(`${rootDir}${sep}`);
}

function portablePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split("\\").join("/");
}

async function writeState(rootDir: string, state: WorkflowRunState): Promise<void> {
  await writeRunState(resolveHarnessLayout(rootDir).stateRoot, state.runId, state);
}

async function readState(rootDir: string, runId: string): Promise<WorkflowRunState> {
  return parseRunState(await readRunState(resolveHarnessLayout(rootDir).stateRoot, runId));
}

async function readAllStates(rootDir: string): Promise<WorkflowRunState[]> {
  return (await readAllRunStates(resolveHarnessLayout(rootDir).stateRoot)).map(parseRunState);
}

async function loadWorkflow(rootDir: string, workflowPath: string): Promise<LoadedWorkflow> {
  const resolvedPath = resolve(rootDir, workflowPath);
  if (!isInsideWorkspace(resolveHarnessLayout(rootDir).workflowsRoot, resolvedPath)) {
    throw new Error("Workflow 路径必须位于 Harness Root 的 workflows/ 内。");
  }
  const source = await readFile(resolvedPath, "utf8");
  const result = await compileWorkflow({ rootDir, workflowPath: resolvedPath });
  if (!result.ok || result.workflow === null) {
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("；");
    throw new Error(`Workflow 编译失败：${messages}`);
  }
  return {
    workflow: result.workflow,
    workflowPath: portablePath(rootDir, resolvedPath),
    workflowHash: digest(source),
  };
}

function getChecks(task: unknown): string[] {
  const metadata = asRecord(asRecord(task)?.metadata);
  const harness = asRecord(metadata?.harness);
  const checks = harness?.checks;
  return Array.isArray(checks)
    ? checks.filter((check): check is string => typeof check === "string")
    : [];
}

function maxStepAttempts(workflow: Specification.Workflow): number {
  const metadata = asRecord(workflow.document.metadata);
  const harness = asRecord(metadata?.harness);
  const execution = asRecord(harness?.execution);
  const configured = execution?.maxStepAttempts;
  return typeof configured === "number" && Number.isInteger(configured) && configured > 0
    ? configured
    : 3;
}

function directiveFor(rootDir: string, entry: TaskEntry, attempt: number): WorkflowStepDirective {
  const call = asRecord(entry.task)?.call;
  if (typeof call !== "string") {
    throw new Error(`Step '${entry.id}' 不是可执行的本地 Skill。`);
  }
  const checks = getChecks(entry.task);
  const layout = resolveHarnessLayout(rootDir);
  return {
    id: entry.id,
    attempt,
    skillPath: portablePath(layout.workspaceRoot, join(layout.skillsRoot, call, "SKILL.md")),
    checkPaths: checks.map((check) =>
      portablePath(layout.workspaceRoot, join(layout.checksRoot, check, "CHECK.md")),
    ),
  };
}

function responseFromState(
  state: WorkflowRunState,
  status: WorkflowRunStatus = state.status,
  checkExecutions?: CheckCommandExecution[],
): WorkflowRuntimeResponse {
  return {
    runId: state.runId,
    status,
    revision: state.revision,
    ...(state.currentStep === null
      ? {}
      : {
          step: {
            id: state.currentStep.id,
            attempt: state.currentStep.attempt,
            skillPath: state.currentStep.skillPath,
            checkPaths: state.currentStep.checkPaths,
          },
        }),
    ...(state.evidence.length === 0 ? {} : { evidence: state.evidence }),
    ...(state.output === undefined ? {} : { output: state.output }),
    ...(checkExecutions === undefined || checkExecutions.length === 0
      ? {}
      : { checkExecutions }),
  };
}

async function assertWorkflowInput(
  rootDir: string,
  workflow: Specification.Workflow,
  input: unknown,
): Promise<void> {
  const diagnostics = await validateWorkflowData({
    rootDir,
    workflow,
    target: "input",
    data: input,
  });
  if (diagnostics.length > 0) {
    throw new Error(`Workflow input 不符合 JSON Schema：${diagnostics[0]?.message ?? "未知错误"}`);
  }
}

function resumeExistingRun(
  state: WorkflowRunState,
  loaded: LoadedWorkflow,
  inputDigest: string,
  workspaceRoot: string,
): WorkflowRuntimeResponse {
  if (
    state.workflowPath !== loaded.workflowPath ||
    state.workflowHash !== loaded.workflowHash ||
    state.inputDigest !== inputDigest ||
    state.workspaceRoot !== workspaceRoot
  ) {
    throw new Error("executionKey 已绑定到不同的 Workflow 或输入。");
  }
  return responseFromState(state, state.status === "running" ? "interrupted" : state.status);
}

function firstSkillStep(workflow: Specification.Workflow): TaskEntry {
  const first = taskEntries(workflow)[0];
  if (first === undefined || typeof asRecord(first.task)?.call !== "string") {
    throw new Error("Workflow 起点必须是本地 Skill Step。");
  }
  return first;
}

function createRunState(
  options: StartWorkflowRunOptions,
  loaded: LoadedWorkflow,
  workspaceRoot: string,
  inputDigest: string,
): WorkflowRunState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    executionKey: options.executionKey,
    workspaceRoot,
    workflowPath: loaded.workflowPath,
    workflowName: loaded.workflow.document.name,
    workflowVersion: loaded.workflow.document.version,
    workflowHash: loaded.workflowHash,
    inputDigest,
    status: "running",
    revision: 1,
    currentStep: null,
    attempts: {},
    evidence: [],
    checkExecutions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function startStep(
  rootDir: string,
  state: WorkflowRunState,
  workflow: Specification.Workflow,
  entry: TaskEntry,
): { response: WorkflowRuntimeResponse; state: WorkflowRunState } {
  const attempt = (state.attempts[entry.id] ?? 0) + 1;
  const maximum = maxStepAttempts(workflow);
  if (attempt > maximum) {
    const evidence = `Step '${entry.id}' 超过最大尝试次数 ${String(maximum)}。`;
    const blockedState: WorkflowRunState = {
      ...state,
      status: "blocked",
      currentStep: null,
      evidence: [...state.evidence, evidence],
    };
    return { state: blockedState, response: responseFromState(blockedState) };
  }
  const directive = directiveFor(rootDir, entry, attempt);
  const runningState: WorkflowRunState = {
    ...state,
    status: "running",
    currentStep: { ...directive, phase: "in_progress" },
    attempts: { ...state.attempts, [entry.id]: attempt },
  };
  return { state: runningState, response: responseFromState(runningState) };
}

function assertStepResult(state: WorkflowRunState, result: StepResult): void {
  if (state.status !== "running" || state.currentStep === null) {
    throw new Error(`Workflow Run 已结束：${state.status}`);
  }
  if (result.runId !== state.runId) {
    throw new Error("Step Result 的 runId 不匹配。");
  }
  if (result.revision !== state.revision) {
    throw new Error("Step Result Revision 已过期。");
  }
  if (result.stepId !== state.currentStep.id) {
    throw new Error("Step Result 的 stepId 不是当前 Step。");
  }
  if (
    !Array.isArray(result.evidence) ||
    result.evidence.length === 0 ||
    result.evidence.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error("Step Result evidence 必须是非空字符串数组。");
  }
  if (!new Set<StepResultStatus>(["passed", "needs_changes", "blocked"]).has(result.status)) {
    throw new Error("Step Result status 非法。");
  }
}

async function startWorkflowRunUnlocked(
  options: StartWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  const workspaceRoot = resolve(
    options.workspaceRoot ?? resolveHarnessLayout(rootDir).workspaceRoot,
  );
  if (options.executionKey.trim().length === 0) {
    throw new Error("executionKey 不能为空。");
  }
  const loaded = await loadWorkflow(rootDir, options.workflowPath);
  await assertWorkflowInput(rootDir, loaded.workflow, options.input);
  const inputDigest = digest(JSON.stringify(options.input));
  const existingStates = await readAllStates(rootDir);
  const sameExecution = existingStates
    .filter((state) => state.executionKey === options.executionKey)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (sameExecution !== undefined) {
    return resumeExistingRun(sameExecution, loaded, inputDigest, workspaceRoot);
  }
  if (existingStates.some((state) => state.status === "running")) {
    throw new Error("当前 Worktree 已存在运行中的 Workflow。");
  }

  const baseState = createRunState(options, loaded, workspaceRoot, inputDigest);
  const started = startStep(rootDir, baseState, loaded.workflow, firstSkillStep(loaded.workflow));
  await writeState(rootDir, started.state);
  return started.response;
}

type CheckOutcome = {
  effectiveStatus: StepResultStatus;
  checkExecutions: CheckCommandExecution[];
  failedResponse?: WorkflowRuntimeResponse;
};

async function runStepChecks(
  rootDir: string,
  state: WorkflowRunState,
  result: StepResult,
  checkIds: string[],
): Promise<CheckOutcome> {
  if (result.status !== "passed" || checkIds.length === 0) {
    return { effectiveStatus: result.status, checkExecutions: [] };
  }
  try {
    const checkExecutions = await executeDeterministicChecks({
      rootDir,
      workspaceRoot: state.workspaceRoot,
      checkIds,
    });
    return {
      effectiveStatus: checkExecutions.some((execution) => execution.exitCode !== 0)
        ? "needs_changes"
        : result.status,
      checkExecutions,
    };
  } catch (error: unknown) {
    const failedState: WorkflowRunState = {
      ...state,
      status: "failed",
      revision: state.revision + 1,
      currentStep: null,
      evidence: [...state.evidence, error instanceof Error ? error.message : String(error)],
      updatedAt: new Date().toISOString(),
    };
    await writeState(rootDir, failedState);
    return {
      effectiveStatus: "blocked",
      checkExecutions: [],
      failedResponse: responseFromState(failedState),
    };
  }
}

function progressedState(
  state: WorkflowRunState,
  result: StepResult,
  checkExecutions: CheckCommandExecution[],
): WorkflowRunState {
  const commandEvidence = checkExecutions.map(
    (execution) =>
      `${execution.checkId}: ${execution.command} ${execution.args.join(" ")} -> ${String(execution.exitCode)}`,
  );
  return {
    ...state,
    revision: state.revision + 1,
    currentStep: null,
    evidence: [...state.evidence, ...result.evidence, ...commandEvidence],
    checkExecutions: [...state.checkExecutions, ...checkExecutions],
    updatedAt: new Date().toISOString(),
  };
}

async function completeRun(
  rootDir: string,
  workflow: Specification.Workflow,
  state: WorkflowRunState,
  result: StepResult,
  checkExecutions: CheckCommandExecution[],
): Promise<WorkflowRuntimeResponse> {
  const diagnostics = await validateWorkflowData({
    rootDir,
    workflow,
    target: "output",
    data: result.data,
  });
  if (diagnostics.length > 0) {
    throw new Error(`Workflow output 不符合 JSON Schema：${diagnostics[0]?.message ?? "未知错误"}`);
  }
  const completedState: WorkflowRunState = {
    ...state,
    status: "completed",
    ...(result.data === undefined ? {} : { output: result.data }),
  };
  await writeState(rootDir, completedState);
  return responseFromState(completedState, "completed", checkExecutions);
}

export async function startWorkflowRun(
  options: StartWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  return withRuntimeLock(resolveHarnessLayout(rootDir).stateRoot, () =>
    startWorkflowRunUnlocked(options),
  );
}

async function continueWorkflowRunUnlocked(
  options: ContinueWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  const state = await readState(rootDir, options.runId);
  if (options.result === undefined) {
    return responseFromState(state, state.status === "running" ? "interrupted" : state.status);
  }
  assertStepResult(state, options.result);

  const loaded = await loadWorkflow(rootDir, state.workflowPath);
  if (loaded.workflowHash !== state.workflowHash) {
    throw new Error("Workflow 文件已在运行期间改变，当前 Run 已停止推进。");
  }
  const currentTask = findTask(taskEntries(loaded.workflow), options.result.stepId);
  const outcome = await runStepChecks(rootDir, state, options.result, getChecks(currentTask.task));
  if (outcome.failedResponse !== undefined) return outcome.failedResponse;
  const { checkExecutions, effectiveStatus } = outcome;
  const baseState = progressedState(state, options.result, checkExecutions);

  if (effectiveStatus === "blocked") {
    const blockedState: WorkflowRunState = { ...baseState, status: "blocked" };
    await writeState(rootDir, blockedState);
    return responseFromState(blockedState, "blocked", checkExecutions);
  }

  const nextStep = resolveNextStep(loaded.workflow, options.result.stepId, effectiveStatus);
  if (nextStep === null) {
    return completeRun(rootDir, loaded.workflow, baseState, options.result, checkExecutions);
  }

  const advanced = startStep(rootDir, baseState, loaded.workflow, nextStep);
  await writeState(rootDir, advanced.state);
  return {
    ...advanced.response,
    ...(checkExecutions.length === 0 ? {} : { checkExecutions }),
  };
}

export async function continueWorkflowRun(
  options: ContinueWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  return withRuntimeLock(resolveHarnessLayout(rootDir).stateRoot, () =>
    continueWorkflowRunUnlocked(options),
  );
}

async function cancelWorkflowRunUnlocked(
  options: CancelWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  const state = await readState(rootDir, options.runId);
  if (state.status === "completed" || state.status === "cancelled" || state.status === "failed") {
    throw new Error(`Workflow Run 已结束：${state.status}`);
  }
  const cancelledState: WorkflowRunState = {
    ...state,
    status: "cancelled",
    revision: state.revision + 1,
    currentStep: null,
    evidence: [...state.evidence, options.reason],
    updatedAt: new Date().toISOString(),
  };
  await writeState(rootDir, cancelledState);
  return responseFromState(cancelledState);
}

export async function cancelWorkflowRun(
  options: CancelWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  return withRuntimeLock(resolveHarnessLayout(rootDir).stateRoot, () =>
    cancelWorkflowRunUnlocked(options),
  );
}

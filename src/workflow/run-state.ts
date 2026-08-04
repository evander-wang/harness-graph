import type { CheckCommandExecution } from "./checks.js";

export type WorkflowStepDirective = {
  id: string;
  attempt: number;
  skillPath: string;
  checkPaths: string[];
};

export type PersistedRunStatus =
  | "running"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export type WorkflowTraceEntry =
  | {
      type: "step_started";
      stepId: string;
      attempt: number;
      revision: number;
      at: string;
    }
  | {
      type: "step_result";
      stepId: string;
      attempt: number;
      revision: number;
      status: "passed" | "needs_changes" | "blocked" | "failed";
      evidence: string[];
      checkExecutions: CheckCommandExecution[];
      at: string;
    }
  | {
      type: "transition";
      fromStepId: string;
      toStepId: string | null;
      status: "passed" | "needs_changes" | "blocked";
      at: string;
    }
  | {
      type: "workflow_completed" | "workflow_cancelled" | "workflow_failed";
      at: string;
    };

type CurrentStep = WorkflowStepDirective & {
  phase: "in_progress";
};

export type WorkflowRunState = {
  schemaVersion: 1;
  runId: string;
  executionKey: string;
  workspaceRoot: string;
  workflowPath: string;
  workflowName: string;
  workflowVersion: string;
  workflowHash: string;
  inputDigest: string;
  status: PersistedRunStatus;
  revision: number;
  currentStep: CurrentStep | null;
  attempts: Record<string, number>;
  evidence: string[];
  checkExecutions: CheckCommandExecution[];
  executionTrace: WorkflowTraceEntry[];
  createdAt: string;
  updatedAt: string;
  output?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Workflow Run 状态字段 '${key}' 无效。`);
  }
  return value;
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Workflow Run 状态字段 '${key}' 无效。`);
  }
  return value.map((item: unknown) => {
    if (typeof item !== "string") {
      throw new Error(`Workflow Run 状态字段 '${key}' 无效。`);
    }
    return item;
  });
}

function parseAttempts(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Error("Workflow Run attempts 无效。");
  const attempts: Record<string, number> = {};
  for (const [stepId, attempt] of Object.entries(value)) {
    if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
      throw new Error("Workflow Run attempts 无效。");
    }
    attempts[stepId] = attempt;
  }
  return attempts;
}

function parseCheckExecution(value: unknown): CheckCommandExecution {
  if (!isRecord(value)) throw new Error("Workflow Run Check 执行证据无效。");
  const cwd = value.cwd;
  if (
    (cwd !== "harness" && cwd !== "workspace") ||
    typeof value.exitCode !== "number" ||
    typeof value.durationMs !== "number"
  ) {
    throw new Error("Workflow Run Check 执行证据无效。");
  }
  return {
    checkId: requiredString(value, "checkId"),
    command: requiredString(value, "command"),
    args: stringArray(value.args, "checkExecutions.args"),
    cwd,
    exitCode: value.exitCode,
    durationMs: value.durationMs,
    outputDigest: requiredString(value, "outputDigest"),
  };
}

function parseCurrentStep(value: unknown): CurrentStep | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    value.phase !== "in_progress" ||
    typeof value.attempt !== "number" ||
    !Number.isInteger(value.attempt) ||
    value.attempt <= 0
  ) {
    throw new Error("Workflow Run currentStep 无效。");
  }
  return {
    id: requiredString(value, "id"),
    attempt: value.attempt,
    skillPath: requiredString(value, "skillPath"),
    checkPaths: stringArray(value.checkPaths, "currentStep.checkPaths"),
    phase: "in_progress",
  };
}

function parseStatus(value: unknown): PersistedRunStatus {
  switch (value) {
    case "running":
    case "blocked":
    case "completed":
    case "cancelled":
    case "failed":
      return value;
    default:
      throw new Error("Workflow Run 状态文件无效。");
  }
}

function parseTraceEntry(value: unknown): WorkflowTraceEntry {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.at !== "string") {
    throw new Error("Workflow Run executionTrace 无效。");
  }
  if (value.type === "step_started") {
    if (
      typeof value.stepId !== "string" ||
      typeof value.attempt !== "number" ||
      !Number.isInteger(value.attempt) ||
      typeof value.revision !== "number" ||
      !Number.isInteger(value.revision)
    ) {
      throw new Error("Workflow Run executionTrace 无效。");
    }
    return {
      type: "step_started",
      stepId: value.stepId,
      attempt: value.attempt,
      revision: value.revision,
      at: value.at,
    };
  }
  if (value.type === "step_result") {
    const status = value.status;
    if (
      typeof value.stepId !== "string" ||
      typeof value.attempt !== "number" ||
      !Number.isInteger(value.attempt) ||
      typeof value.revision !== "number" ||
      !Number.isInteger(value.revision) ||
      !["passed", "needs_changes", "blocked", "failed"].includes(status as string) ||
      !Array.isArray(value.checkExecutions)
    ) {
      throw new Error("Workflow Run executionTrace 无效。");
    }
    return {
      type: "step_result",
      stepId: value.stepId,
      attempt: value.attempt,
      revision: value.revision,
      status: status as "passed" | "needs_changes" | "blocked" | "failed",
      evidence: stringArray(value.evidence, "executionTrace.evidence"),
      checkExecutions: value.checkExecutions.map(parseCheckExecution),
      at: value.at,
    };
  }
  if (value.type === "transition") {
    if (
      typeof value.fromStepId !== "string" ||
      (value.toStepId !== null && typeof value.toStepId !== "string") ||
      !["passed", "needs_changes", "blocked"].includes(value.status as string)
    ) {
      throw new Error("Workflow Run executionTrace 无效。");
    }
    return {
      type: "transition",
      fromStepId: value.fromStepId,
      toStepId: value.toStepId,
      status: value.status as "passed" | "needs_changes" | "blocked",
      at: value.at,
    };
  }
  if (
    value.type === "workflow_completed" ||
    value.type === "workflow_cancelled" ||
    value.type === "workflow_failed"
  ) {
    return { type: value.type, at: value.at };
  }
  throw new Error("Workflow Run executionTrace 无效。");
}

export function parseRunState(value: unknown): WorkflowRunState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    !Array.isArray(value.checkExecutions)
  ) {
    throw new Error("Workflow Run 状态文件无效。");
  }
  return {
    schemaVersion: 1,
    runId: requiredString(value, "runId"),
    executionKey: requiredString(value, "executionKey"),
    workspaceRoot: requiredString(value, "workspaceRoot"),
    workflowPath: requiredString(value, "workflowPath"),
    workflowName: requiredString(value, "workflowName"),
    workflowVersion: requiredString(value, "workflowVersion"),
    workflowHash: requiredString(value, "workflowHash"),
    inputDigest: requiredString(value, "inputDigest"),
    status: parseStatus(value.status),
    revision: value.revision,
    currentStep: parseCurrentStep(value.currentStep),
    attempts: parseAttempts(value.attempts),
    evidence: stringArray(value.evidence, "evidence"),
    checkExecutions: value.checkExecutions.map(parseCheckExecution),
    executionTrace: "executionTrace" in value && Array.isArray(value.executionTrace)
      ? value.executionTrace.map(parseTraceEntry)
      : [],
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
    ...("output" in value ? { output: value.output } : {}),
  };
}

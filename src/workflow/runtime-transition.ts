import type { Specification } from "@openworkflowspec/sdk";

type StepResultStatus = "passed" | "needs_changes" | "blocked";

export type TaskEntry = {
  id: string;
  task: unknown;
  index: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function taskEntries(workflow: Specification.Workflow): TaskEntry[] {
  return workflow.do.flatMap((item, index) => {
    const entry = Object.entries(item)[0];
    return entry === undefined ? [] : [{ id: entry[0], task: entry[1], index }];
  });
}

export function findTask(entries: readonly TaskEntry[], stepId: string): TaskEntry {
  const entry = entries.find((candidate) => candidate.id === stepId);
  if (entry === undefined) {
    throw new Error(`Workflow 中不存在 Step '${stepId}'。`);
  }
  return entry;
}

function conditionMatches(condition: string, status: StepResultStatus): boolean {
  const match = /^\.status\s*==\s*["'](passed|needs_changes|blocked)["']$/u.exec(condition);
  if (match === null) {
    throw new Error(`Runtime 不支持 switch 条件：${condition}`);
  }
  return match[1] === status;
}

function switchTarget(task: unknown, status: StepResultStatus): string | undefined {
  const branches = asRecord(task)?.switch;
  if (!Array.isArray(branches)) {
    throw new Error("目标 Step 不是 switch。");
  }
  let defaultTarget: string | undefined;
  for (const branchItem of branches) {
    const branchEntry = Object.entries(asRecord(branchItem) ?? {})[0];
    if (branchEntry === undefined) continue;
    const branch = asRecord(branchEntry[1]);
    const when = branch?.when;
    const then = branch?.then;
    if (typeof then !== "string") continue;
    if (typeof when === "string" && conditionMatches(when, status)) return then;
    if (when === undefined) defaultTarget = then;
  }
  return defaultTarget;
}

function transitionCandidate(
  entries: readonly TaskEntry[],
  target: unknown,
  nextIndex: number,
): TaskEntry | null {
  if (target === "end" || target === "exit") return null;
  if (target === undefined || target === "continue") return entries[nextIndex] ?? null;
  return typeof target === "string"
    ? entries.find((entry) => entry.id === target) ?? null
    : null;
}

function returnsToCurrentStep(
  status: StepResultStatus,
  target: unknown,
  sequential: TaskEntry | undefined,
): boolean {
  return status === "needs_changes" &&
    target === undefined &&
    (sequential === undefined || !Array.isArray(asRecord(sequential.task)?.switch));
}

export function resolveNextStep(
  workflow: Specification.Workflow,
  currentStepId: string,
  status: StepResultStatus,
): TaskEntry | null {
  const entries = taskEntries(workflow);
  const current = findTask(entries, currentStepId);
  let target = asRecord(current.task)?.then;
  let nextIndex = current.index + 1;
  if (returnsToCurrentStep(status, target, entries[nextIndex])) return current;

  for (let hops = 0; hops <= entries.length; hops += 1) {
    const candidate = transitionCandidate(entries, target, nextIndex);
    if (candidate === null) return null;
    const candidateTask = asRecord(candidate.task);
    if (typeof candidateTask?.call === "string") return candidate;
    if (Array.isArray(candidateTask?.switch)) {
      target = switchTarget(candidate.task, status);
      nextIndex = candidate.index + 1;
      continue;
    }
    throw new Error(`Step '${candidate.id}' 不是 Runtime 支持的 Task。`);
  }
  throw new Error("Workflow Transition 超过最大解析深度。");
}

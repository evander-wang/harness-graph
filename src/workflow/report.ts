import type { CheckCommandExecution } from "./checks.js";
import { parseRunState, type WorkflowRunState, type WorkflowTraceEntry } from "./run-state.js";
import { resolveHarnessLayout } from "./paths.js";
import { readRunState } from "./runtime-state.js";

export type WorkflowExecutionReportStep = {
  id: string;
  attempt: number;
  status: "running" | "passed" | "needs_changes" | "blocked" | "failed";
  evidence: string[];
  checkExecutions: CheckCommandExecution[];
  startedAt: string;
  completedAt?: string;
};

export type WorkflowExecutionReport = {
  runId: string;
  status: WorkflowRunState["status"];
  workflow: {
    name: string;
    path: string;
    version: string;
    hash: string;
  };
  createdAt: string;
  updatedAt: string;
  steps: WorkflowExecutionReportStep[];
  transitions: Array<{
    fromStepId: string;
    toStepId: string | null;
    status: "passed" | "needs_changes" | "blocked";
    at: string;
  }>;
  output?: unknown;
};

function findStep(
  steps: readonly WorkflowExecutionReportStep[],
  stepId: string,
  attempt: number,
): WorkflowExecutionReportStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step !== undefined && step.id === stepId && step.attempt === attempt) return step;
  }
  return undefined;
}

function applyTraceEntry(
  steps: WorkflowExecutionReportStep[],
  transitions: WorkflowExecutionReport["transitions"],
  entry: WorkflowTraceEntry,
): void {
  if (entry.type === "step_started") {
    steps.push({
      id: entry.stepId,
      attempt: entry.attempt,
      status: "running",
      evidence: [],
      checkExecutions: [],
      startedAt: entry.at,
    });
    return;
  }
  if (entry.type === "step_result") {
    const step = findStep(steps, entry.stepId, entry.attempt);
    if (step === undefined) return;
    step.status = entry.status;
    step.evidence = entry.evidence;
    step.checkExecutions = entry.checkExecutions;
    step.completedAt = entry.at;
    return;
  }
  if (entry.type === "transition") {
    transitions.push({
      fromStepId: entry.fromStepId,
      toStepId: entry.toStepId,
      status: entry.status,
      at: entry.at,
    });
  }
}

export function buildWorkflowExecutionReport(state: WorkflowRunState): WorkflowExecutionReport {
  const steps: WorkflowExecutionReportStep[] = [];
  const transitions: WorkflowExecutionReport["transitions"] = [];
  for (const entry of state.executionTrace) applyTraceEntry(steps, transitions, entry);
  return {
    runId: state.runId,
    status: state.status,
    workflow: {
      name: state.workflowName,
      path: state.workflowPath,
      version: state.workflowVersion,
      hash: state.workflowHash,
    },
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    steps,
    transitions,
    ...(state.output === undefined ? {} : { output: state.output }),
  };
}

export async function loadWorkflowExecutionReport(
  rootDir: string,
  runId: string,
): Promise<WorkflowExecutionReport> {
  const stateRoot = resolveHarnessLayout(rootDir).stateRoot;
  return buildWorkflowExecutionReport(parseRunState(await readRunState(stateRoot, runId)));
}

export function renderWorkflowExecutionReport(report: WorkflowExecutionReport): string {
  const lines = [
    `Workflow: ${report.workflow.name} (${report.workflow.version})`,
    `Status: ${report.status}`,
    `Run: ${report.runId}`,
    "",
    "Steps:",
    ...report.steps.flatMap((step, index) => [
      `${String(index + 1)}. ${step.id} [${step.status}] (attempt ${String(step.attempt)})`,
      ...step.checkExecutions.map(
        (execution) => `   Check: ${execution.checkId} [${execution.exitCode === 0 ? "passed" : "needs_changes"}]`,
      ),
    ]),
  ];
  if (report.transitions.length > 0) {
    lines.push("", "Transitions:");
    lines.push(
      ...report.transitions.map((transition) =>
        `- ${transition.fromStepId} -> ${transition.toStepId ?? "end"} [${transition.status}]`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

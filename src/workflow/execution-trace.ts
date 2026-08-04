import type { CheckCommandExecution } from "./checks.js";
import type { WorkflowRunState, WorkflowTraceEntry } from "./run-state.js";

export function appendStepStarted(
  state: WorkflowRunState,
  stepId: string,
  attempt: number,
): WorkflowRunState {
  const entry: WorkflowTraceEntry = {
    type: "step_started",
    stepId,
    attempt,
    revision: state.revision,
    at: new Date().toISOString(),
  };
  return { ...state, executionTrace: [...state.executionTrace, entry] };
}

export function appendStepResult(
  state: WorkflowRunState,
  stepId: string,
  attempt: number,
  status: "passed" | "needs_changes" | "blocked" | "failed",
  evidence: string[],
  checkExecutions: CheckCommandExecution[],
): WorkflowRunState {
  const entry: WorkflowTraceEntry = {
    type: "step_result",
    stepId,
    attempt,
    revision: state.revision,
    status,
    evidence,
    checkExecutions,
    at: new Date().toISOString(),
  };
  return { ...state, executionTrace: [...state.executionTrace, entry] };
}

export function appendTransition(
  state: WorkflowRunState,
  fromStepId: string,
  status: "passed" | "needs_changes" | "blocked",
  toStepId: string | null,
): WorkflowRunState {
  const entry: WorkflowTraceEntry = {
    type: "transition",
    fromStepId,
    toStepId,
    status,
    at: new Date().toISOString(),
  };
  return { ...state, executionTrace: [...state.executionTrace, entry] };
}

export function appendTerminal(
  state: WorkflowRunState,
  type: "workflow_completed" | "workflow_cancelled" | "workflow_failed",
): WorkflowRunState {
  return {
    ...state,
    executionTrace: [...state.executionTrace, { type, at: new Date().toISOString() }],
  };
}

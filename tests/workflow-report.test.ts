import { describe, expect, test } from "vitest";

import {
  buildWorkflowExecutionReport,
  renderWorkflowExecutionReport,
} from "../src/workflow/report.js";
import type { WorkflowRunState } from "../src/workflow/run-state.js";

const state: WorkflowRunState = {
  schemaVersion: 1,
  runId: "run-1",
  executionKey: "task-1",
  workspaceRoot: "/workspace",
  workflowPath: "workflows/demo/workflow.yaml",
  workflowName: "demo",
  workflowVersion: "1.2.0",
  workflowHash: "sha256:abc",
  inputDigest: "sha256:input",
  status: "completed",
  revision: 3,
  currentStep: null,
  attempts: { inspect: 1, implement: 1 },
  evidence: ["done"],
  checkExecutions: [],
  executionTrace: [
    { type: "step_started", stepId: "inspect", attempt: 1, revision: 1, at: "2026-08-04T00:00:00.000Z" },
    {
      type: "step_result",
      stepId: "inspect",
      attempt: 1,
      revision: 1,
      status: "passed",
      evidence: ["inspected"],
      checkExecutions: [],
      at: "2026-08-04T00:01:00.000Z",
    },
    { type: "transition", fromStepId: "inspect", toStepId: "implement", status: "passed", at: "2026-08-04T00:01:00.000Z" },
    { type: "step_started", stepId: "implement", attempt: 1, revision: 2, at: "2026-08-04T00:01:01.000Z" },
    {
      type: "step_result",
      stepId: "implement",
      attempt: 1,
      revision: 2,
      status: "passed",
      evidence: ["implemented"],
      checkExecutions: [],
      at: "2026-08-04T00:02:00.000Z",
    },
    { type: "transition", fromStepId: "implement", toStepId: null, status: "passed", at: "2026-08-04T00:02:00.000Z" },
    { type: "workflow_completed", at: "2026-08-04T00:02:00.000Z" },
  ],
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:02:00.000Z",
};

describe("Workflow execution report", () => {
  test("从 Run executionTrace 生成实际 Step 顺序和 Transition", () => {
    const report = buildWorkflowExecutionReport(state);

    expect(report).toMatchObject({
      runId: "run-1",
      workflow: {
        name: "demo",
        path: "workflows/demo/workflow.yaml",
        version: "1.2.0",
      },
      status: "completed",
      steps: [
        { id: "inspect", attempt: 1, status: "passed" },
        { id: "implement", attempt: 1, status: "passed" },
      ],
      transitions: [
        { fromStepId: "inspect", toStepId: "implement", status: "passed" },
        { fromStepId: "implement", toStepId: null, status: "passed" },
      ],
    });

    const markdown = renderWorkflowExecutionReport(report);
    expect(markdown).toContain("Workflow: demo (1.2.0)");
    expect(markdown).toContain("1. inspect [passed]");
    expect(markdown).toContain("2. implement [passed]");
  });
});

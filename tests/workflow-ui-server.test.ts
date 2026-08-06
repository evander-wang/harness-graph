import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWorkflowUiServer } from "../src/workflow/ui-server.js";

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveStart();
    });
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("测试服务未返回 TCP 地址。");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

describe("Workflow UI server", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createWorkflowUiServer({ rootDir: process.cwd() });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolveClose();
        } else {
          reject(error);
        }
      });
    });
  });

  it("returns all workflows with activated entry markers", async () => {
    const response = await fetch(`${baseUrl}/api/workflows`);
    const body = asRecord(await response.json());
    const workflows = body.workflows;
    const entryWorkflows = body.entryWorkflows;

    expect(response.status).toBe(200);
    expect(entryWorkflows).toEqual([
      "node-typescript-development",
      "node-project-configuration",
    ]);
    expect(Array.isArray(workflows)).toBe(true);
    expect(workflows).toHaveLength(4);
    expect(workflows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "node-typescript-development", entry: true }),
      expect.objectContaining({ name: "change-execution-policy", entry: false }),
    ]));
  });

  it("returns compiled graph, steps, and source files for a workflow", async () => {
    const response = await fetch(`${baseUrl}/api/workflows/node-typescript-development`);
    const body = asRecord(await response.json());
    const graph = asRecord(body.graph);
    const expandedGraph = asRecord(body.expandedGraph);
    const steps = body.steps;
    const expandedSteps = body.expandedSteps;
    const files = body.files;

    expect(response.status).toBe(200);
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(Array.isArray(expandedGraph.nodes)).toBe(true);
    expect(expandedGraph.nodes).toHaveLength(16);
    expect(expandedSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "load-change-execution-policy",
        workflowName: "change-execution-policy",
        kind: "skill",
      }),
      expect.objectContaining({
        id: "load-node-typescript-standards",
        workflowName: "node-typescript-standards",
      }),
    ]));
    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "analyze-change",
        nodeId: "/do/0/analyze-change",
        call: "analyze-node-change",
        checks: ["change-plan-ready"],
      }),
      expect.objectContaining({ id: "decide-plan", kind: "switch" }),
    ]));
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "harness/workflows/node-typescript-development/workflow.yaml",
        kind: "workflow",
      }),
      expect.objectContaining({
        path: "harness/skills/analyze-node-change/SKILL.md",
        kind: "skill",
      }),
      expect.objectContaining({
        path: "harness/checks/change-plan-ready/CHECK.md",
        kind: "check",
      }),
      expect.objectContaining({
        path: "harness/models/node-change-request.schema.json",
        kind: "model",
      }),
      expect.objectContaining({
        path: "harness/workflows/change-execution-policy/workflow.yaml",
        kind: "workflow",
      }),
      expect.objectContaining({
        path: "harness/skills/load-node-typescript-standards/SKILL.md",
        kind: "skill",
      }),
    ]));
  });

  it("does not treat an unknown workflow name as a file path", async () => {
    const response = await fetch(`${baseUrl}/api/workflows/..%2F..%2Fpackage.json`);
    const body = asRecord(await response.json());

    expect(response.status).toBe(404);
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toContain("package.json");
  });
});

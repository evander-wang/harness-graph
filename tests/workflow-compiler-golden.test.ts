import { join, resolve } from "node:path";

import { GraphNodeType } from "@openworkflowspec/sdk";
import { describe, test } from "vitest";

import { compileWorkflow } from "../src/workflow/compiler.js";
import { expectGolden } from "./helpers/golden.js";

const rootDir = resolve(import.meta.dirname, "..");
const workflowPaths = [
  "harness/workflows/change-execution-policy/workflow.yaml",
  "harness/workflows/node-project-configuration/workflow.yaml",
  "harness/workflows/node-typescript-development/workflow.yaml",
  "harness/workflows/node-typescript-standards/workflow.yaml",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function checksFor(task: unknown): string[] {
  const metadata = asRecord(asRecord(task)?.metadata);
  const harness = asRecord(metadata?.harness);
  return Array.isArray(harness?.checks)
    ? harness.checks.filter((value): value is string => typeof value === "string")
    : [];
}

describe("Workflow compiler Golden", () => {
  test("锁定 Workflow 的 Step、Check 和 Transition", async () => {
    const snapshots = [];
    for (const workflowPath of workflowPaths) {
      const result = await compileWorkflow({ rootDir, workflowPath });
      if (!result.ok || result.workflow === null || result.graph === null) {
        throw new Error(`${workflowPath} 编译失败：${JSON.stringify(result.diagnostics)}`);
      }
      const nodeNames = new Map(
        result.graph.nodes.map((node) => {
          return [
            node.id,
            node.type === GraphNodeType.Start
              ? "start"
              : node.type === GraphNodeType.End
                ? "end"
                : (node.label ?? node.id),
          ];
        }),
      );
      const nodeName = (id: string): string => {
        const name = nodeNames.get(id);
        if (name === undefined) throw new Error(`FlatGraph 引用了不存在的节点：${id}`);
        return name;
      };
      snapshots.push({
        path: workflowPath,
        document: {
          dsl: result.workflow.document.dsl,
          namespace: result.workflow.document.namespace,
          name: result.workflow.document.name,
          version: result.workflow.document.version,
        },
        nodes: result.graph.nodes
          .map((node) => {
            const task = asRecord(node.task);
            return {
              id: nodeName(node.id),
              type: node.type,
              ...(typeof task?.call === "string" ? { call: task.call } : {}),
              checks: checksFor(node.task),
            };
          })
          .sort((left, right) => left.id.localeCompare(right.id)),
        transitions: result.graph.edges
          .map((edge) => ({
            from: nodeName(edge.sourceId),
            to: nodeName(edge.targetId),
            label: edge.label ?? "",
          }))
          .sort((left, right) =>
            `${left.from}|${left.to}|${left.label}`.localeCompare(
              `${right.from}|${right.to}|${right.label}`,
            ),
          ),
      });
    }

    await expectGolden(
      join(rootDir, "tests/fixtures/workflow-compiler.golden.json"),
      snapshots,
    );
  });
});

import { access, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import {
  buildFlatGraph,
  Classes,
  type FlatGraph,
  type Specification,
} from "@openworkflowspec/sdk";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import { resolveHarnessLayout } from "./paths.js";

export type Diagnostic = {
  code: string;
  message: string;
};

export type CompileWorkflowOptions = {
  rootDir: string;
  workflowPath: string;
};

export type CompileWorkflowResult = {
  ok: boolean;
  workflow: Specification.Workflow | null;
  graph: FlatGraph | null;
  mermaid: string | null;
  diagnostics: Diagnostic[];
};

export type ValidateWorkflowDataOptions = {
  rootDir: string;
  workflow: Specification.Workflow;
  target: "input" | "output";
  data: unknown;
};

type LoadedDataSchema = {
  root: AnySchema;
  referenced: Map<string, AnySchema>;
};

const REMOTE_CALLS = new Set(["a2a", "asyncapi", "grpc", "http", "mcp", "openapi"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getChecks(task: unknown): string[] {
  const metadata = asRecord(asRecord(task)?.metadata);
  const harness = asRecord(metadata?.harness);
  const checks = harness?.checks;
  return Array.isArray(checks) ? checks.filter((check): check is string => typeof check === "string") : [];
}

function executionDiagnostics(workflow: Specification.Workflow): Diagnostic[] {
  const documentMetadata = asRecord(workflow.document.metadata);
  const documentHarness = asRecord(documentMetadata?.harness);
  const execution = asRecord(documentHarness?.execution);
  const maxStepAttempts = execution?.maxStepAttempts;
  if (
    maxStepAttempts === undefined ||
    (typeof maxStepAttempts === "number" && Number.isInteger(maxStepAttempts) && maxStepAttempts > 0)
  ) {
    return [];
  }
  return [{
    code: "execution.invalid-max-attempts",
    message: "document.metadata.harness.execution.maxStepAttempts 必须是正整数。",
  }];
}

function switchConditionDiagnostics(stepId: string, task: Record<string, unknown>): Diagnostic[] {
  if (!Array.isArray(task.switch)) return [];
  const diagnostics: Diagnostic[] = [];
  for (const branchItem of task.switch) {
    const branchEntry = Object.entries(asRecord(branchItem) ?? {})[0];
    const condition = branchEntry === undefined ? undefined : asRecord(branchEntry[1])?.when;
    if (
      typeof condition === "string" &&
      !/^\.status\s*==\s*["'](passed|needs_changes|blocked)["']$/u.test(condition)
    ) {
      diagnostics.push({
        code: "switch.unsupported-condition",
        message: `Step '${stepId}' 使用了 Runtime 不支持的条件：${condition}`,
      });
    }
  }
  return diagnostics;
}

function taskProfileDiagnostics(stepId: string, task: unknown): Diagnostic[] {
  const taskRecord = asRecord(task);
  const isLocalCall = typeof taskRecord?.call === "string";
  const isSwitch = Array.isArray(taskRecord?.switch);
  const unsupported = isLocalCall || isSwitch
    ? []
    : [{
        code: "task.unsupported",
        message: `Step '${stepId}' 使用了首版 Harness 尚未支持的 Task 类型。`,
      }];
  return [...unsupported, ...(taskRecord === null ? [] : switchConditionDiagnostics(stepId, taskRecord))];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validateHarnessProfile(workflow: Specification.Workflow): Diagnostic[] {
  const diagnostics = executionDiagnostics(workflow);

  if (asRecord(workflow)?.schedule !== undefined) {
    diagnostics.push({
      code: "workflow.unsupported-feature",
      message: "当前项目只执行本地 Agent Workflow，不支持 schedule。",
    });
  }

  for (const item of workflow.do) {
    const entry = Object.entries(item)[0];
    if (entry === undefined) {
      continue;
    }
    diagnostics.push(...taskProfileDiagnostics(entry[0], entry[1]));
  }

  return diagnostics;
}

function nextTaskFor(
  task: Record<string, unknown>,
  index: number,
  taskEntries: readonly ([string, unknown] | undefined)[],
  tasksById: ReadonlyMap<string, unknown>,
): unknown {
  const then = task.then;
  if (typeof then === "string" && !["continue", "end", "exit"].includes(then)) {
    return tasksById.get(then);
  }
  return then === undefined || then === "continue" ? taskEntries[index + 1]?.[1] : undefined;
}

async function validateSkillBinding(
  stepId: string,
  task: unknown,
  index: number,
  taskEntries: readonly ([string, unknown] | undefined)[],
  tasksById: ReadonlyMap<string, unknown>,
  rootDir: string,
): Promise<Diagnostic[]> {
  const taskRecord = asRecord(task);
  if (taskRecord === null) return [];
  const call = taskRecord.call;
  if (typeof call !== "string") return [];
  if (REMOTE_CALLS.has(call)) {
    return [{
      code: "task.unsupported",
      message: `Step '${stepId}' 使用了当前项目不支持的远程调用：${call}`,
    }];
  }
  const diagnostics: Diagnostic[] = [];
  const layout = resolveHarnessLayout(rootDir);
  if (!(await pathExists(join(layout.skillsRoot, call, "SKILL.md")))) {
    const skillRoot = layout.installed ? "skills" : "harness/skills";
    diagnostics.push({
      code: "skill.not-found",
      message: `Step '${stepId}' 引用的 Skill 不存在：${skillRoot}/${call}/SKILL.md`,
    });
  }
  const checks = getChecks(task);
  if (Array.isArray(asRecord(nextTaskFor(taskRecord, index, taskEntries, tasksById))?.switch) && checks.length === 0) {
    diagnostics.push({
      code: "check.required-before-switch",
      message: `Step '${stepId}' 进入 switch 前必须绑定至少一个 Check。`,
    });
  }
  for (const check of checks) {
    if (!(await pathExists(join(layout.checksRoot, check, "CHECK.md")))) {
      diagnostics.push({
        code: "check.not-found",
        message: `Step '${stepId}' 引用的 Check 不存在：checks/${check}/CHECK.md`,
      });
    }
  }
  return diagnostics;
}

async function validateLocalBindings(
  workflow: Specification.Workflow,
  rootDir: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const taskEntries = workflow.do.map((item) => Object.entries(item)[0]);
  const tasksById = new Map<string, unknown>();
  for (const entry of taskEntries) {
    if (entry !== undefined) {
      tasksById.set(entry[0], entry[1]);
    }
  }

  for (const [index, entry] of taskEntries.entries()) {
    if (entry === undefined) continue;
    diagnostics.push(
      ...(await validateSkillBinding(
        entry[0],
        entry[1],
        index,
        taskEntries,
        tasksById,
        rootDir,
      )),
    );
  }

  return diagnostics;
}

function validateGraph(workflow: Specification.Workflow, graph: FlatGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const reachableNodeIds = new Set(graph.nodes.map((node) => node.id));

  workflow.do.forEach((item, index) => {
    const entry = Object.entries(item)[0];
    if (entry === undefined) {
      return;
    }
    const [stepId] = entry;
    if (!reachableNodeIds.has(`/do/${String(index)}/${stepId}`)) {
      diagnostics.push({
        code: "workflow.unreachable-step",
        message: `Step '${stepId}' 无法从 Workflow 起点到达。`,
      });
    }
  });

  const reverseEdges = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = reverseEdges.get(edge.targetId) ?? [];
    sources.push(edge.sourceId);
    reverseEdges.set(edge.targetId, sources);
  }

  const terminalId = graph.exitNode?.id;
  if (terminalId !== undefined) {
    const canReachTerminal = new Set<string>([terminalId]);
    const pending = [terminalId];
    while (pending.length > 0) {
      const target = pending.pop();
      if (target === undefined) {
        continue;
      }
      for (const source of reverseEdges.get(target) ?? []) {
        if (!canReachTerminal.has(source)) {
          canReachTerminal.add(source);
          pending.push(source);
        }
      }
    }

    const blockedNodes = graph.nodes.filter(
      (node) => node.id !== terminalId && !canReachTerminal.has(node.id),
    );
    if (blockedNodes.length > 0) {
      diagnostics.push({
        code: "workflow.no-terminal-path",
        message: "Workflow 存在无法到达结束节点的执行路径。",
      });
    }
  }

  return diagnostics;
}

function isJsonSchema(value: unknown): value is AnySchema {
  return typeof value === "boolean" || asRecord(value) !== null;
}

function resolveModelSchemaPath(rootDir: string, endpoint: string): string {
  if (!endpoint.startsWith("harness://models/")) {
    throw new Error("外部 Schema 必须使用 harness://models/ URI。");
  }
  const resourceEndpoint = endpoint.split("#", 1)[0];
  if (resourceEndpoint === undefined) {
    throw new Error("Schema URI 无效。");
  }
  const relativePath = resourceEndpoint.slice("harness://".length);
  const modelsRoot = resolveHarnessLayout(rootDir).modelsRoot;
  const schemaPath = resolve(modelsRoot, relativePath.replace(/^models\//u, ""));
  if (schemaPath !== modelsRoot && !schemaPath.startsWith(`${modelsRoot}${sep}`)) {
    throw new Error("Schema URI 超出了 harness/models/ 目录。");
  }
  return schemaPath;
}

async function readModelSchema(rootDir: string, endpoint: string): Promise<AnySchema> {
  const parsedSchema = JSON.parse(
    await readFile(resolveModelSchemaPath(rootDir, endpoint), "utf8"),
  ) as unknown;
  if (!isJsonSchema(parsedSchema)) {
    throw new Error("外部 JSON Schema 必须是对象或布尔值。");
  }
  return parsedSchema;
}

function collectSchemaReferences(value: unknown, references: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaReferences(item, references);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  const reference = record.$ref;
  if (typeof reference === "string" && !reference.startsWith("#")) {
    if (!reference.startsWith("harness://models/")) {
      throw new Error("Schema $ref 只允许使用 harness://models/ URI 或当前文档片段。");
    }
    const endpoint = reference.split("#", 1)[0];
    if (endpoint !== undefined) references.add(endpoint);
  }
  for (const child of Object.values(record)) collectSchemaReferences(child, references);
}

async function loadReferencedSchemas(
  rootDir: string,
  rootSchema: AnySchema,
): Promise<Map<string, AnySchema>> {
  const schemas = new Map<string, AnySchema>();
  const pending = new Set<string>();
  collectSchemaReferences(rootSchema, pending);
  while (pending.size > 0) {
    const endpoint = pending.values().next().value;
    if (endpoint === undefined) break;
    pending.delete(endpoint);
    if (schemas.has(endpoint)) continue;
    const schema = await readModelSchema(rootDir, endpoint);
    schemas.set(endpoint, schema);
    const nested = new Set<string>();
    collectSchemaReferences(schema, nested);
    for (const reference of nested) {
      if (!schemas.has(reference)) pending.add(reference);
    }
  }
  return schemas;
}

async function loadDataSchema(
  options: ValidateWorkflowDataOptions,
): Promise<LoadedDataSchema | null> {
  const dataDefinition = asRecord(options.workflow[options.target]);
  const schema = asRecord(dataDefinition?.schema);
  if (schema === null) {
    return null;
  }
  if ("document" in schema) {
    if (!isJsonSchema(schema.document)) {
      throw new Error("内联 JSON Schema 必须是对象或布尔值。");
    }
    return {
      root: schema.document,
      referenced: await loadReferencedSchemas(options.rootDir, schema.document),
    };
  }

  const resource = asRecord(schema.resource);
  const endpoint = resource?.endpoint;
  if (typeof endpoint !== "string") {
    throw new Error("外部 Schema 必须使用 harness://models/ URI。");
  }
  const root = await readModelSchema(options.rootDir, endpoint);
  return {
    root,
    referenced: await loadReferencedSchemas(options.rootDir, root),
  };
}

export async function validateWorkflowData(
  options: ValidateWorkflowDataOptions,
): Promise<Diagnostic[]> {
  try {
    const loaded = await loadDataSchema(options);
    if (loaded === null) {
      return [];
    }

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    for (const [endpoint, schema] of loaded.referenced) {
      ajv.addSchema(schema, endpoint);
    }
    const validateData = ajv.compile(loaded.root);
    if (validateData(options.data)) {
      return [];
    }

    const details = ajv.errorsText(validateData.errors, { separator: "；" });
    return [
      {
        code: "data.schema-invalid",
        message: `Workflow ${options.target} 不符合 JSON Schema：${details}`,
      },
    ];
  } catch (error: unknown) {
    return [
      {
        code: "schema.invalid",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

export async function compileWorkflow(options: CompileWorkflowOptions): Promise<CompileWorkflowResult> {
  try {
    const source = await readFile(options.workflowPath, "utf8");
    const workflow = Classes.Workflow.deserialize(source);
    workflow.validate();
    const graph = buildFlatGraph(workflow, true);
    const diagnostics = [
      ...validateHarnessProfile(workflow),
      ...(await validateLocalBindings(workflow, options.rootDir)),
      ...validateGraph(workflow, graph),
    ];

    return {
      ok: diagnostics.length === 0,
      workflow,
      graph,
      mermaid: workflow.toMermaidCode(),
      diagnostics,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      workflow: null,
      graph: null,
      mermaid: null,
      diagnostics: [
        {
          code: "workflow.invalid",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

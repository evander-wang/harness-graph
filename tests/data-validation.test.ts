import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { compileWorkflow, validateWorkflowData } from "../src/workflow/compiler.js";

describe("validateWorkflowData", () => {
  test("项目配置 Workflow 校验完整 Profile 并拒绝非 strict TypeScript", async () => {
    const rootDir = join(import.meta.dirname, "..");
    const workflowPath = join(
      rootDir,
      "harness/workflows/node-typescript-project-configuration/workflow.yaml",
    );
    const compiled = await compileWorkflow({ rootDir, workflowPath });
    expect(compiled.workflow).not.toBeNull();
    if (compiled.workflow === null) throw new Error("项目配置 Workflow 编译失败");

    const profile = {
      projectState: "existing",
      projectKind: "service",
      nodeVersion: "22",
      packageManager: {
        name: "npm",
        version: "11.3.0",
        detectedBy: ["package.json#packageManager", "package-lock.json"],
      },
      moduleSystem: "esm",
      source: {
        sourceDir: "src",
        testDir: "tests",
        entrypoints: ["src/cli.ts"],
        outputDir: "dist",
      },
      scripts: {
        typecheck: "npm run typecheck",
        lint: "npm run lint",
        test: "npm test",
        build: "npm run build",
        checkAll: "npm run check:all",
      },
      quality: {
        strictTypeScript: true,
        noExplicitAny: true,
        testRunner: "vitest",
      },
      configuration: {
        environments: [],
        configSource: "none",
        validationEntry: null,
        secretPolicy: "not-applicable",
      },
      optionalCapabilities: [],
    };
    const result = {
      status: "done",
      profile,
      changedFiles: ["package.json"],
      verification: ["npm run check:all 通过"],
      preservedDecisions: ["保留 ESM"],
      risks: [],
    };

    const valid = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "output",
      data: result,
    });
    const invalid = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "output",
      data: {
        ...result,
        profile: {
          ...profile,
          quality: { ...profile.quality, strictTypeScript: false },
        },
      },
    });

    expect(valid).toEqual([]);
    expect(invalid.map((diagnostic) => diagnostic.code)).toEqual(["data.schema-invalid"]);
  });

  test("外部 Schema 可以通过 harness URI 复用另一个 Model", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-graph-schema-ref-"));
    const workflowPath = join(rootDir, "harness/workflows/example/workflow.yaml");
    await mkdir(join(rootDir, "harness/workflows/example"), { recursive: true });
    await mkdir(join(rootDir, "harness/models"), { recursive: true });
    await mkdir(join(rootDir, "harness/skills/run-example"), { recursive: true });
    await writeFile(join(rootDir, "harness/skills/run-example/SKILL.md"), "# 执行示例\n");
    await writeFile(
      join(rootDir, "harness/models/profile.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "harness://models/profile.schema.json",
        type: "object",
        required: ["name"],
        properties: { name: { type: "string", minLength: 1 } },
        additionalProperties: false,
      }),
    );
    await writeFile(
      join(rootDir, "harness/models/result.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "harness://models/result.schema.json",
        type: "object",
        required: ["profile"],
        properties: {
          profile: { $ref: "harness://models/profile.schema.json" },
        },
        additionalProperties: false,
      }),
    );
    await writeFile(
      workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: schema-reference
  version: "0.1.0"
output:
  schema:
    resource:
      endpoint: harness://models/result.schema.json
do:
  - run-example:
      call: run-example
      then: end
`,
    );

    const compiled = await compileWorkflow({ rootDir, workflowPath });
    expect(compiled.workflow).not.toBeNull();
    if (compiled.workflow === null) throw new Error("测试 Workflow 编译失败");

    const valid = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "output",
      data: { profile: { name: "example" } },
    });
    const invalid = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "output",
      data: { profile: {} },
    });

    expect(valid).toEqual([]);
    expect(invalid.map((diagnostic) => diagnostic.code)).toEqual(["data.schema-invalid"]);
  });

  test("使用外部 JSON Schema 校验 Workflow 输入和输出", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-graph-data-"));
    const workflowPath = join(rootDir, "harness/workflows/example/workflow.yaml");

    await mkdir(join(rootDir, "harness/workflows/example"), { recursive: true });
    await mkdir(join(rootDir, "harness/models"), { recursive: true });
    await mkdir(join(rootDir, "harness/checks/done"), { recursive: true });
    await mkdir(join(rootDir, "harness/skills/run-example"), { recursive: true });
    await writeFile(join(rootDir, "harness/checks/done/CHECK.md"), "# 完成检查\n");
    await writeFile(join(rootDir, "harness/skills/run-example/SKILL.md"), "# 执行示例\n");
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
  name: data-validation
  version: "0.1.0"
input:
  schema:
    resource:
      endpoint: harness://models/request.schema.json
output:
  schema:
    resource:
      endpoint: harness://models/result.schema.json
do:
  - run-example:
      call: run-example
      metadata:
        harness:
          checks: [done]
      then: end
`,
    );

    const compiled = await compileWorkflow({ rootDir, workflowPath });
    expect(compiled.workflow).not.toBeNull();
    if (compiled.workflow === null) {
      throw new Error("测试 Workflow 编译失败");
    }

    const validInput = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "input",
      data: { title: "实现 Workflow" },
    });
    const invalidInput = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "input",
      data: {},
    });
    const invalidOutput = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "output",
      data: { status: "pending" },
    });

    expect(validInput).toEqual([]);
    expect(invalidInput.map((diagnostic) => diagnostic.code)).toEqual(["data.schema-invalid"]);
    expect(invalidOutput.map((diagnostic) => diagnostic.code)).toEqual(["data.schema-invalid"]);
  });
});

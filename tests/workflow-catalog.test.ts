import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  activateWorkflowCatalog,
  buildWorkflowCatalog,
  checkWorkflowCatalog,
  syncWorkflowCatalog,
} from "../src/workflow/catalog.js";
import { compileWorkflow } from "../src/workflow/compiler.js";

async function writeWorkflow(
  rootDir: string,
  directory: string,
  options: {
    name: string;
    title: string;
    aliases?: string[];
    when?: string[];
    notWhen?: string[];
    prerequisites?: string[];
  },
): Promise<void> {
  const workflowDirectory = join(rootDir, "harness/workflows", directory);
  await mkdir(workflowDirectory, { recursive: true });
  await mkdir(join(rootDir, "harness/skills/run-example"), { recursive: true });
  await writeFile(join(rootDir, "harness/skills/run-example/SKILL.md"), "# 执行\n");
  await writeFile(
    join(workflowDirectory, "workflow.yaml"),
    `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: ${options.name}
  version: "0.1.0"
  title: ${options.title}
  summary: ${options.title}流程。
  metadata:
    harness:
      routing:
        aliases: ${JSON.stringify(options.aliases ?? [])}
        when: ${JSON.stringify(options.when ?? [])}
        notWhen: ${JSON.stringify(options.notWhen ?? [])}
      prerequisites: ${JSON.stringify(options.prerequisites ?? [])}
do:
  - run-example:
      call: run-example
      then: end
`,
  );
}

async function writeActivation(
  rootDir: string,
  entryWorkflowPaths: readonly string[],
): Promise<void> {
  await writeFile(
    join(rootDir, "harness/workflow-activation.yaml"),
    `version: 1
entryWorkflowPaths:\n${entryWorkflowPaths.map((path) => `  - ${path}`).join("\n")}\n`,
  );
}

describe("syncWorkflowCatalog", () => {
  test("安装布局从扁平资产目录生成 Catalog", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-installed-catalog-"));
    const harnessRoot = join(workspaceRoot, "harness-graph");
    await mkdir(join(harnessRoot, "workflows/example"), { recursive: true });
    await mkdir(join(harnessRoot, "skills/run-example"), { recursive: true });
    await writeFile(join(harnessRoot, "skills/run-example/SKILL.md"), "# 执行\n");
    await writeFile(
      join(harnessRoot, "workflows/example/workflow.yaml"),
      `document:\n  dsl: "1.0.3"\n  namespace: harness-graph\n  name: installed-example\n  version: "1.0.0"\n  metadata:\n    harness:\n      routing:\n        aliases: []\n        when: [开发]\n        notWhen: []\ndo:\n  - run-example:\n      call: run-example\n      then: end\n`,
    );

    const result = await syncWorkflowCatalog({ rootDir: harnessRoot });

    expect(result.catalog.workflows).toEqual([
      expect.objectContaining({ name: "installed-example", path: "workflows/example/workflow.yaml" }),
    ]);
    await expect(readFile(join(harnessRoot, "generated/workflow-catalog.json"), "utf8")).resolves.toContain("installed-example");
  });

  test("修改类 Workflow 组合通用执行协议和领域前置依赖", async () => {
    const rootDir = resolve(import.meta.dirname, "..");
    const policy = await compileWorkflow({
      rootDir,
      workflowPath: join(rootDir, "harness/workflows/change-execution-policy/workflow.yaml"),
    });
    const development = await compileWorkflow({
      rootDir,
      workflowPath: join(rootDir, "harness/workflows/node-typescript-development/workflow.yaml"),
    });
    const projectConfiguration = await compileWorkflow({
      rootDir,
      workflowPath: join(rootDir, "harness/workflows/node-project-configuration/workflow.yaml"),
    });
    const standards = await compileWorkflow({
      rootDir,
      workflowPath: join(rootDir, "harness/workflows/node-typescript-standards/workflow.yaml"),
    });
    const catalog = await buildWorkflowCatalog(rootDir);
    const developmentEntry = catalog.workflows.find(
      (entry) => entry.name === "node-typescript-development",
    );
    const projectConfigurationEntry = catalog.workflows.find(
      (entry) => entry.name === "node-project-configuration",
    );

    expect(policy.ok).toBe(true);
    expect(policy.workflow?.do).toEqual([
      {
        "load-change-execution-policy": {
          call: "load-change-execution-policy",
          then: "end",
        },
      },
    ]);
    expect(development.ok).toBe(true);
    expect(development.workflow?.do[0]).toMatchObject({
      "analyze-change": { call: "analyze-node-change" },
    });
    expect(projectConfiguration.ok).toBe(true);
    expect(projectConfiguration.workflow?.do[0]).toMatchObject({
      "analyze-project": {
        metadata: {
          harness: {
            checks: ["change-plan-ready", "node-project-plan-ready"],
          },
        },
      },
    });
    expect(projectConfiguration.workflow?.do[5]).toMatchObject({
      "review-project": {
        metadata: {
          harness: {
            checks: ["change-review-result", "node-project-review-result"],
          },
        },
      },
    });
    expect(standards.ok).toBe(true);
    expect(standards.workflow?.do).toHaveLength(1);
    expect(standards.workflow?.do[0]).toMatchObject({
      "load-node-typescript-standards": {
        call: "load-node-typescript-standards",
        then: "end",
      },
    });
    expect(developmentEntry?.prerequisites).toEqual([
      "change-execution-policy",
      "node-typescript-standards",
    ]);
    expect(projectConfigurationEntry?.prerequisites).toEqual([
      "change-execution-policy",
    ]);
    const policySkill = await readFile(
      join(rootDir, "harness/skills/load-change-execution-policy/SKILL.md"),
      "utf8",
    );
    expect(policySkill).toContain("第一次写入前");
    expect(policySkill).toContain("修改已有文件前");
    expect(policySkill).toContain("适用测试");
    expect(policySkill).toContain("成功证据");
    const standardGuide = await readFile(
      join(rootDir, "harness/workflows/node-typescript-standards/STANDARDS.md"),
      "utf8",
    );
    expect(standardGuide).toContain("maxFunctionLines: 80");
    const standardNode = await readFile(
      join(rootDir, "harness/skills/load-node-typescript-standards/SKILL.md"),
      "utf8",
    );
    expect(standardNode).toContain("STANDARDS.md");
    const qualityGate = await readFile(
      join(rootDir, "harness/checks/node-quality-gate/CHECK.md"),
      "utf8",
    );
    expect(qualityGate).toContain(
      "args: [runtime/dist/cli.js, node-policy-check, --changed]",
    );
  });

  test("拒绝不存在的前置 Workflow", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "feature", {
      name: "feature-workflow",
      title: "功能流程",
      prerequisites: ["missing-workflow"],
    });

    await expect(buildWorkflowCatalog(rootDir)).rejects.toThrow(
      "Workflow 'feature-workflow' 引用了不存在的前置 Workflow：missing-workflow",
    );
  });

  test("拒绝循环前置 Workflow", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "first", {
      name: "first-workflow",
      title: "第一流程",
      prerequisites: ["second-workflow"],
    });
    await writeWorkflow(rootDir, "second", {
      name: "second-workflow",
      title: "第二流程",
      prerequisites: ["first-workflow"],
    });

    await expect(buildWorkflowCatalog(rootDir)).rejects.toThrow(
      "Workflow 前置依赖存在循环：first-workflow -> second-workflow -> first-workflow",
    );
  });

  test("标准 Workflow 的规范正文可被质量门禁定位", async () => {
    const rootDir = resolve(import.meta.dirname, "..");
    const standards = await readFile(
      join(rootDir, "harness/skills/load-node-typescript-standards/SKILL.md"),
      "utf8",
    );
    expect(standards).toContain("harness/workflows/node-typescript-standards/STANDARDS.md");
  });

  test("真实 Catalog 包含项目配置 Workflow 的清晰路由边界", async () => {
    const rootDir = resolve(import.meta.dirname, "..");

    const catalog = await buildWorkflowCatalog(rootDir);
    const workflow = catalog.workflows.find(
      (entry) => entry.name === "node-project-configuration",
    );

    expect(workflow).toMatchObject({
      title: "Node.js TypeScript 项目配置",
      routing: {
        aliases: ["node-project-setup", "node-project-standardization"],
      },
    });
    expect(workflow?.routing.when).toContain("初始化新的 Node.js TypeScript 项目");
    expect(workflow?.routing.notWhen).toContain("开发业务功能或修复业务代码缺陷");
  });

  test("扫描 Workflow 并生成稳定排序的 Catalog", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "second", {
      name: "second-workflow",
      title: "第二流程",
      aliases: ["second"],
      when: ["执行第二类任务"],
    });
    await writeWorkflow(rootDir, "first", {
      name: "first-workflow",
      title: "第一流程",
      aliases: ["first"],
      when: ["执行第一类任务"],
      notWhen: ["只读分析"],
    });

    const result = await syncWorkflowCatalog({ rootDir });
    const catalogPath = join(rootDir, "harness/generated/workflow-catalog.json");
    const persisted = JSON.parse(await readFile(catalogPath, "utf8")) as unknown;

    expect(result.changed).toBe(true);
    expect(result.catalog.workflows.map((workflow) => workflow.name)).toEqual([
      "first-workflow",
      "second-workflow",
    ]);
    expect(result.catalog.workflows[0]).toMatchObject({
      name: "first-workflow",
      path: "harness/workflows/first/workflow.yaml",
      title: "第一流程",
      routing: {
        aliases: ["first"],
        when: ["执行第一类任务"],
        notWhen: ["只读分析"],
      },
    });
    expect(result.catalog.workflows[0]?.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(persisted).toEqual(result.catalog);
  });

  test("全量同步将全部 Workflow 标记为入口", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "first", { name: "first-workflow", title: "第一流程" });
    await writeWorkflow(rootDir, "second", { name: "second-workflow", title: "第二流程" });

    const result = await syncWorkflowCatalog({ rootDir });

    expect(result.catalog).toMatchObject({
      mode: "all",
      entryWorkflows: ["first-workflow", "second-workflow"],
    });
    await expect(checkWorkflowCatalog({ rootDir })).resolves.toMatchObject({ changed: false });
  });

  test("激活声明只生成入口 Workflow 及其递归前置依赖", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "standards", {
      name: "standards-workflow",
      title: "开发规范",
    });
    await writeWorkflow(rootDir, "development", {
      name: "development-workflow",
      title: "业务开发",
      prerequisites: ["standards-workflow"],
    });
    await writeWorkflow(rootDir, "unused", { name: "unused-workflow", title: "未启用流程" });
    await writeActivation(rootDir, ["harness/workflows/development/workflow.yaml"]);

    const result = await activateWorkflowCatalog({ rootDir });
    const persisted = JSON.parse(
      await readFile(join(rootDir, "harness/generated/workflow-catalog.json"), "utf8"),
    ) as { mode: string; entryWorkflows: string[]; workflows: Array<{ name: string }> };

    expect(result.catalog).toMatchObject({
      mode: "selected",
      entryWorkflows: ["development-workflow"],
    });
    expect(result.catalog.workflows.map((workflow) => workflow.name)).toEqual([
      "development-workflow",
      "standards-workflow",
    ]);
    expect(persisted).toEqual(result.catalog);
  });

  test("拒绝重复的 Workflow 名称和 Alias", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "one", {
      name: "workflow-one",
      title: "流程一",
      aliases: ["shared"],
    });
    await writeWorkflow(rootDir, "two", {
      name: "workflow-two",
      title: "流程二",
      aliases: ["shared"],
    });

    await expect(syncWorkflowCatalog({ rootDir })).rejects.toThrow(
      "Workflow 路由名称或 Alias 重复：shared",
    );
  });

  test("check 模式在 Catalog 过期时失败且不写文件", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "example", {
      name: "example-workflow",
      title: "示例流程",
    });
    const catalogPath = join(rootDir, "harness/generated/workflow-catalog.json");

    await expect(syncWorkflowCatalog({ rootDir, check: true })).rejects.toThrow(
      "Workflow Catalog 已过期",
    );
    await expect(readFile(catalogPath, "utf8")).rejects.toThrow();
  });
});

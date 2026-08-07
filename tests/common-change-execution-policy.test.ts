import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { compileWorkflow } from "../src/workflow/compiler.js";

const rootDir = resolve(import.meta.dirname, "..");

async function readProjectFile(path: string): Promise<string> {
  return readFile(join(rootDir, path), "utf8");
}

describe("change execution policy assets", () => {
  test("非平凡任务在展示后落盘计划并声明接口文档影响", async () => {
    const policy = await readProjectFile("harness/skills/common-load-change-execution-policy/SKILL.md");

    expect(policy).toContain("docs/plans/");
    expect(policy).toContain("接口与文档影响");
    expect(policy).toContain("计划文件是展示后允许的第一次写入");
    expect(policy).toContain("现有文档约定");
    expect(policy).toContain("多文件");
    expect(policy).toContain("公开 Interface");
  });

  test("分析 Skill 保存非平凡计划并向后续 Step 提交路径证据", async () => {
    const analysisSkills = await Promise.all([
      readProjectFile("harness/skills/node-typescript-analyze-change/SKILL.md"),
      readProjectFile("harness/skills/node-typescript-analyze-project/SKILL.md"),
    ]);

    for (const skill of analysisSkills) {
      expect(skill).toContain("已加载的通用执行协议");
      expect(skill).toContain("非平凡任务");
      expect(skill).toContain("计划文件");
      expect(skill).toContain("planPath=");
      expect(skill).toContain("不得修改生产代码或配置");
    }
  });

  test("实现 Skill 读取已通过计划并同步接口事实源", async () => {
    const implementationSkills = await Promise.all([
      readProjectFile("harness/skills/node-typescript-implement-change/SKILL.md"),
      readProjectFile("harness/skills/node-typescript-configure-project/SKILL.md"),
    ]);

    for (const skill of implementationSkills) {
      expect(skill).toContain("planPath=");
      expect(skill).toContain("完整读取计划文件");
      expect(skill).toContain("接口与文档影响");
      expect(skill).toContain("机器事实源");
      expect(skill).toContain("更新计划");
    }
  });

  test("通用 Check 验证计划落盘并在 Review 对照接口文档", async () => {
    const planCheck = await readProjectFile("harness/checks/common-change-plan-ready/CHECK.md");
    const reviewCheck = await readProjectFile("harness/checks/common-change-review-result/CHECK.md");

    expect(planCheck).toContain("planPath=");
    expect(planCheck).toContain("未落盘原因");
    expect(planCheck).toContain("接口与文档影响");
    expect(planCheck).toContain("计划文件");
    expect(planCheck).toContain("CONTEXT.md");
    expect(planCheck).toContain("STANDARDS.md");
    expect(planCheck).toContain("docs/adr/");

    expect(reviewCheck).toContain("planPath=");
    expect(reviewCheck).toContain("计划文件");
    expect(reviewCheck).toContain("机器事实源");
    expect(reviewCheck).toContain("面向使用者的说明");
    expect(reviewCheck).toContain("实际 Diff");
    expect(reviewCheck).toContain("CONTEXT.md");
    expect(reviewCheck).toContain("STANDARDS.md");
    expect(reviewCheck).toContain("docs/adr/");
  });

  test("共享策略集中声明公开接口的默认事实源和说明位置", async () => {
    const policy = await readProjectFile("harness/skills/common-load-change-execution-policy/SKILL.md");

    expect(policy).toContain("docs/contracts/http/openapi.yaml");
    expect(policy).toContain("docs/contracts/events/asyncapi.yaml");
    expect(policy).toContain("proto/");
    expect(policy).toContain("docs/reference/cli.md");
    expect(policy).toContain("workflows/<name>/workflow.yaml");
    expect(policy).toContain("models/*.schema.json");
    expect(policy).toContain("现有接口文档约定");
  });

  test("共享策略行为升级为可固定的 Workflow 版本", async () => {
    const result = await compileWorkflow({
      rootDir,
      workflowPath: "harness/workflows/common-change-execution-policy/workflow.yaml",
    });

    expect(result.ok).toBe(true);
    expect(result.workflow?.document.version).toBe("1.1.0");
  });
});

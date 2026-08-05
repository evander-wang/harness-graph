import { mkdtemp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, test } from "vitest";

import { main } from "../src/cli.js";

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "harness-graph-cli-"));
  await mkdir(join(rootDir, "harness/workflows/example"), { recursive: true });
  await mkdir(join(rootDir, "harness/checks/done"), { recursive: true });
  await mkdir(join(rootDir, "harness/models"), { recursive: true });
  await mkdir(join(rootDir, "harness/schemas"), { recursive: true });
  await mkdir(join(rootDir, "skills/run-example"), { recursive: true });
  await writeFile(join(rootDir, "AGENTS.md"), "# 约束\n");
  await writeFile(join(rootDir, "README.md"), "# 项目\n");
  await writeFile(join(rootDir, "keywords.md"), "# 关键词\n");
  await writeFile(join(rootDir, "CONTRIBUTING.md"), "# 贡献\n");
  await writeFile(join(rootDir, "package.json"), "{}\n");
  await writeFile(join(rootDir, "package-lock.json"), "{}\n");
  await writeFile(join(rootDir, "tsconfig.json"), "{}\n");
  await writeFile(join(rootDir, "harness/checks/done/CHECK.md"), "# 检查\n");
  await writeFile(join(rootDir, "skills/run-example/SKILL.md"), "# 执行\n");
  await writeFile(
    join(rootDir, "harness/workflows/example/workflow.yaml"),
    `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: cli-example
  version: "0.1.0"
do:
  - run-example:
      call: run-example
      metadata:
        harness:
          checks: [done]
      then: end
`,
  );
  return rootDir;
}

async function createCheckableNodeProject(): Promise<string> {
  const rootDir = await createProject();
  await mkdir(join(rootDir, ".github/workflows"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "checkable-project",
        packageManager: "npm@10.0.0",
        engines: { node: ">=22.0.0 <23" },
        scripts: {
          typecheck: "node -e \"\"",
          lint: "node -e \"\"",
          test: "node -e \"\"",
          build: "node -e \"\"",
          "check:all": "node -e \"\"",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(rootDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`,
  );
  await writeFile(join(rootDir, "eslint.config.js"), "export default [];\n");
  await writeFile(join(rootDir, ".gitignore"), "node_modules\n");
  await writeFile(join(rootDir, ".nvmrc"), "22\n");
  await writeFile(
    join(rootDir, ".github/workflows/ci.yml"),
    "jobs:\n  check:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n",
  );
  return rootDir;
}

async function writeNodeTypeScriptPolicy(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, "harness", "workflows", "node-typescript-standards"), {
    recursive: true,
  });
  await writeFile(
    join(rootDir, "harness", "workflows", "node-typescript-standards", "STANDARDS.md"),
    `---
version: "1.0.0"
scope:
  includeDirectories: [src]
  excludeDirectories: [node_modules, dist]
limits:
  maxLineLength: 120
  maxFunctionLines: 80
  maxFileLines: 600
  maxCyclomaticComplexity: 10
---

# Node.js TypeScript 开发规范
`,
    "utf8",
  );
}

async function addWorkflowWithPrerequisite(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, "harness/workflows/standards"), { recursive: true });
  await mkdir(join(rootDir, "harness/workflows/development"), { recursive: true });
  await mkdir(join(rootDir, "skills/load-standards"), { recursive: true });
  await writeFile(join(rootDir, "skills/load-standards/SKILL.md"), "# Load standards\n");
  await writeFile(
    join(rootDir, "harness/workflows/standards/workflow.yaml"),
    `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: standards
  version: "1.0.0"
  title: 开发规范
do:
  - load-standards:
      call: load-standards
      then: end
`,
  );
  await writeFile(
    join(rootDir, "harness/workflows/development/workflow.yaml"),
    `document:
  dsl: "1.0.3"
  namespace: harness-graph
  name: development
  version: "1.0.0"
  title: 业务开发
  metadata:
    harness:
      prerequisites: [standards]
do:
  - run-example:
      call: run-example
      then: end
`,
  );
}

async function writeActivation(rootDir: string, entryWorkflowPaths: readonly string[]): Promise<void> {
  await writeFile(
    join(rootDir, "harness/workflow-activation.yaml"),
    `version: 1
entryWorkflowPaths:\n${entryWorkflowPaths.map((path) => `  - ${path}`).join("\n")}\n`,
  );
}

describe("CLI", () => {
  test("node-policy-check 输出 Node.js TypeScript 规范违规", async () => {
    const rootDir = await createProject();
    await writeNodeTypeScriptPolicy(rootDir);
    await mkdir(join(rootDir, "src"), { recursive: true });
    await writeFile(join(rootDir, "src", "too-wide.ts"), `const value = "${"x".repeat(121)}";\n`);
    const output: string[] = [];

    const code = await main(["node-policy-check"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(1);
    expect(JSON.parse(output.at(-1) ?? "{}")).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "source.line-too-long" })],
    });
  });

  test("node-policy-check --changed 在非 Git 目录返回失败码", async () => {
    const rootDir = await createProject();
    await writeNodeTypeScriptPolicy(rootDir);
    const output: string[] = [];

    const code = await main(["node-policy-check", "--changed"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(1);
    expect(output).toContain("无法读取 Git 变更列表。");
  });

  test("validate 校验 Workflow，diagram 输出 Mermaid", async () => {
    const rootDir = await createProject();
    const output: string[] = [];
    const io = {
      cwd: rootDir,
      stdout: (message: string) => output.push(message),
      stderr: (message: string) => output.push(message),
    };

    const validateCode = await main(
      ["validate", "harness/workflows/example/workflow.yaml"],
      io,
    );
    const diagramCode = await main(
      ["diagram", "harness/workflows/example/workflow.yaml"],
      io,
    );

    expect(validateCode).toBe(0);
    expect(diagramCode).toBe(0);
    expect(output).toContain("Workflow：通过");
    expect(output.some((message) => message.includes("flowchart"))).toBe(true);
  });

  test("validate 拒绝 Harness Root 之外的 Workflow 路径", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["validate", "../outside/workflow.yaml"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(2);
    expect(output).toContain("Workflow 路径必须位于 Harness Root 的 workflows/ 内。");
  });

  test("diagram 展开前置 Workflow", async () => {
    const rootDir = await createProject();
    await addWorkflowWithPrerequisite(rootDir);
    const output: string[] = [];

    const code = await main(
      ["diagram", "harness/workflows/development/workflow.yaml", "--expand-prerequisites"],
      {
        cwd: rootDir,
        stdout: (message) => output.push(message),
        stderr: (message) => output.push(message),
      },
    );

    expect(code).toBe(0);
    expect(output.at(-1)).toContain("load-standards");
    expect(output.at(-1)).toContain("prerequisite");
    expect(output.at(-1)).toContain("run-example");
  });

  test("doctor 检查必要目录", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["doctor"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(0);
    expect(output).toEqual(["仓库结构：通过"]);
  });

  test("doctor 报告缺失的 Node.js 项目文件", async () => {
    const rootDir = await createProject();
    await unlink(join(rootDir, "package-lock.json"));
    const output: string[] = [];

    const code = await main(["doctor"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(1);
    expect(output).toContain("- 缺失：package-lock.json");
  });

  test("image 将 Workflow 有向图写入本地 SVG", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["image", "harness/workflows/example/workflow.yaml"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const svg = await readFile(join(rootDir, "harness/generated/cli-example.svg"), "utf8");

    expect(code).toBe(0);
    expect(output).toContain("图片已生成：harness/generated/cli-example.svg");
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("run-example");
  });

  test("image 支持指定工作区内的输出路径", async () => {
    const rootDir = await createProject();

    const code = await main(
      ["image", "harness/workflows/example/workflow.yaml", "docs/workflow.svg"],
      {
        cwd: rootDir,
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );
    const svg = await readFile(join(rootDir, "docs/workflow.svg"), "utf8");

    expect(code).toBe(0);
    expect(svg).toContain("cli-example");
  });

  test("image 展开前置 Workflow 并生成独立 SVG", async () => {
    const rootDir = await createProject();
    await addWorkflowWithPrerequisite(rootDir);

    const code = await main(
      ["image", "harness/workflows/development/workflow.yaml", "--expand-prerequisites"],
      {
        cwd: rootDir,
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );
    const svg = await readFile(join(rootDir, "harness/generated/development-expanded.svg"), "utf8");

    expect(code).toBe(0);
    expect(svg).toContain("load-standards");
    expect(svg).toContain("prerequisite");
    expect(svg).toContain("run-example");
  });

  test("image 拒绝写入当前工作区之外", async () => {
    const rootDir = await createProject();
    const outsideName = `${basename(rootDir)}-outside.svg`;
    const output: string[] = [];

    const code = await main(
      ["image", "harness/workflows/example/workflow.yaml", `../${outsideName}`],
      {
        cwd: rootDir,
        stdout: (message) => output.push(message),
        stderr: (message) => output.push(message),
      },
    );

    expect(code).toBe(2);
    expect(output).toContain("图片输出路径必须位于当前工作区内。");
    await expect(readFile(join(rootDir, "..", outsideName), "utf8")).rejects.toThrow();
  });

  test("sync 生成 Workflow Catalog", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["sync"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const catalog = JSON.parse(
      await readFile(join(rootDir, "harness/generated/workflow-catalog.json"), "utf8"),
    ) as { workflows: Array<{ name: string }> };

    expect(code).toBe(0);
    expect(output).toEqual(["Workflow Catalog：已同步"]);
    expect(catalog.workflows.map((workflow) => workflow.name)).toEqual(["cli-example"]);
  });

  test("activate 从人工维护的声明文件生成 Workflow Catalog", async () => {
    const rootDir = await createProject();
    await writeActivation(rootDir, ["harness/workflows/example/workflow.yaml"]);
    const output: string[] = [];

    const code = await main(["activate"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const catalog = JSON.parse(
      await readFile(join(rootDir, "harness/generated/workflow-catalog.json"), "utf8"),
    ) as { mode: string; entryWorkflows: string[] };

    expect(code).toBe(0);
    expect(output).toEqual(["Workflow Catalog：已激活"]);
    expect(catalog).toMatchObject({ mode: "selected", entryWorkflows: ["cli-example"] });
  });

  test("activate --check 识别当前全量 Catalog", async () => {
    const rootDir = await createProject();
    await main(["sync"], {
      cwd: rootDir,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    const output: string[] = [];

    const code = await main(["activate", "--check"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(0);
    expect(output).toEqual(["Workflow Catalog：激活范围已是最新"]);
  });

  test("project-check 自动执行当前 npm 项目的质量命令", async () => {
    const rootDir = await createCheckableNodeProject();
    const output: string[] = [];

    const code = await main(["project-check"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const result = JSON.parse(output.at(-1) ?? "{}") as {
      ok: boolean;
      executions: Array<{ script: string; exitCode: number }>;
    };

    expect(code).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.executions).toEqual([
      expect.objectContaining({ script: "typecheck", exitCode: 0 }),
      expect.objectContaining({ script: "lint", exitCode: 0 }),
      expect.objectContaining({ script: "test", exitCode: 0 }),
      expect.objectContaining({ script: "build", exitCode: 0 }),
    ]);
  });

  test("project-check 在项目配置缺失时返回结构化问题", async () => {
    const rootDir = await createCheckableNodeProject();
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    delete packageJson.scripts.build;
    await writeFile(join(rootDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
    const output: string[] = [];

    const code = await main(["project-check"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const result = JSON.parse(output.at(-1) ?? "{}") as {
      ok: boolean;
      issues: Array<{ code: string }>;
    };

    expect(code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "script.missing" }));
  });

  test("project-check 可以从 Harness 目录检查另一个目标项目", async () => {
    const harnessRoot = await createProject();
    const projectRoot = await createCheckableNodeProject();
    const output: string[] = [];

    const code = await main(["project-check", projectRoot], {
      cwd: harnessRoot,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const result = JSON.parse(output.at(-1) ?? "{}") as { ok: boolean };

    expect(code).toBe(0);
    expect(result.ok).toBe(true);
  });

  test("start、continue 和 cancel 管理本地 Workflow Run", async () => {
    const rootDir = await createProject();
    const inputPath = join(rootDir, "input.json");
    await writeFile(inputPath, "{}\n");
    const startOutput: string[] = [];

    const startCode = await main(
      ["start", "harness/workflows/example/workflow.yaml", "cli-task", "input.json"],
      {
        cwd: rootDir,
        stdout: (message) => startOutput.push(message),
        stderr: (message) => startOutput.push(message),
      },
    );
    const started = JSON.parse(startOutput[0] ?? "{}") as {
      runId: string;
      revision: number;
      step: { id: string };
    };

    expect(startCode).toBe(0);
    expect(started.step.id).toBe("run-example");

    const resultPath = join(rootDir, "result.json");
    await writeFile(
      resultPath,
      `${JSON.stringify({
        runId: started.runId,
        revision: started.revision,
        stepId: started.step.id,
        status: "blocked",
        evidence: ["等待外部输入"],
      })}\n`,
    );
    const continueOutput: string[] = [];
    const continueCode = await main(["continue", started.runId, "result.json"], {
      cwd: rootDir,
      stdout: (message) => continueOutput.push(message),
      stderr: (message) => continueOutput.push(message),
    });
    const blocked = JSON.parse(continueOutput[0] ?? "{}") as { status: string };

    expect(continueCode).toBe(0);
    expect(blocked.status).toBe("blocked");

    const cancelOutput: string[] = [];
    const cancelCode = await main(["cancel", started.runId, "用户停止"], {
      cwd: rootDir,
      stdout: (message) => cancelOutput.push(message),
      stderr: (message) => cancelOutput.push(message),
    });
    const cancelled = JSON.parse(cancelOutput[0] ?? "{}") as { status: string };

    expect(cancelCode).toBe(0);
    expect(cancelled.status).toBe("cancelled");
  });

  test("report 输出已保存的 Workflow 执行摘要", async () => {
    const rootDir = await createProject();
    await writeFile(join(rootDir, "input.json"), "{}\n");
    const startOutput: string[] = [];
    await main(["start", "harness/workflows/example/workflow.yaml", "report-task", "input.json"], {
      cwd: rootDir,
      stdout: (message) => startOutput.push(message),
      stderr: (message) => startOutput.push(message),
    });
    const started = JSON.parse(startOutput[0] ?? "{}") as {
      runId: string;
      revision: number;
      step: { id: string };
    };
    const resultPath = join(rootDir, "result.json");
    await writeFile(
      resultPath,
      `${JSON.stringify({
        runId: started.runId,
        revision: started.revision,
        stepId: started.step.id,
        status: "passed",
        evidence: ["完成"],
      })}\n`,
    );
    await main(["continue", started.runId, "result.json"], {
      cwd: rootDir,
      stdout: () => undefined,
      stderr: () => undefined,
    });

    const output: string[] = [];
    const code = await main(["report", started.runId, "--format", "markdown"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(0);
    expect(output[0]).toContain("Workflow: cli-example (0.1.0)");
    expect(output[0]).toContain("1. run-example [passed]");
  });

  test("start 从 Workflow Input 固化目标项目目录", async () => {
    const rootDir = await createProject();
    const projectRoot = await mkdtemp(join(tmpdir(), "harness-cli-target-"));
    await writeFile(
      join(rootDir, "input.json"),
      `${JSON.stringify({ projectRoot })}\n`,
    );
    const output: string[] = [];

    const code = await main(
      ["start", "harness/workflows/example/workflow.yaml", "target-task", "input.json"],
      {
        cwd: rootDir,
        stdout: (message) => output.push(message),
        stderr: (message) => output.push(message),
      },
    );
    const started = JSON.parse(output[0] ?? "{}") as { runId: string };
    const state = JSON.parse(
      await readFile(join(rootDir, ".harness/runs", started.runId, "state.json"), "utf8"),
    ) as { workspaceRoot: string };

    expect(code).toBe(0);
    expect(state.workspaceRoot).toBe(projectRoot);
  });
});

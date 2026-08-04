import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import {
  checkHarnessProject,
  installHarnessProject,
  resolveHarnessPaths,
} from "../src/installation/installer.js";

const sourceRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

function installForTest(projectRoot: string) {
  return installHarnessProject({
    sourceRoot,
    projectRoot,
    installRuntimeDependencies: false,
  });
}

const legacyManifest = {
  schemaVersion: 1,
  layoutVersion: 1,
  harnessVersion: "0.1.0",
  installedAt: "2026-08-03T00:00:00.000Z",
  managedEntries: { agents: true, claude: true, gitignore: true },
} as const;

async function downgradeToLegacyInstallation(workspaceRoot: string): Promise<void> {
  await writeFile(
    join(workspaceRoot, "harness-next/installation.json"),
    `${JSON.stringify(legacyManifest, null, 2)}\n`,
    "utf8",
  );
  await Promise.all([
    rm(join(workspaceRoot, "harness-next/skills/harness-next"), { recursive: true }),
    rm(join(workspaceRoot, ".agents/skills/harness-next"), { recursive: true }),
    rm(join(workspaceRoot, ".claude/skills/harness-next"), { recursive: true }),
  ]);
}

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build", "--silent"], { cwd: sourceRoot });
});

describe("installHarnessProject", () => {
  test("安装到空工作区并只复制可提交运行资产", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-install-"));

    const result = await installForTest(workspaceRoot);

    expect(result).toMatchObject({
      status: "installed",
      changed: true,
      projectRoot: ".",
      harnessRoot: "harness-next",
      command: "./harness-next/bin/harness-next route",
      maintainedEntries: [],
    });
    await expect(access(join(workspaceRoot, "harness-next/workflows/node-typescript-development/workflow.yaml"))).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-next/models/node-change-request.schema.json"))).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-next/runtime/dist/cli.js"))).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-next/runtime/package-lock.json"))).resolves.toBeUndefined();
    const runtimePackage = JSON.parse(
      await readFile(join(workspaceRoot, "harness-next/runtime/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runtimePackage).toMatchObject({
      name: "harness-next",
      type: "module",
      bin: { "harness-next": "./dist/cli.js" },
      engines: { node: ">=22.0.0", npm: ">=10.0.0" },
    });
    expect(runtimePackage.scripts).toBeUndefined();
    expect(runtimePackage.devDependencies).toBeUndefined();
    expect(runtimePackage.dependencies).toEqual({
      "@dagrejs/dagre": "^3.0.0",
      "@openworkflowspec/sdk": "1.0.3-alpha4",
      ajv: "^8.17.1",
      "js-yaml": "5.2.1",
      semver: "^7.8.5",
      typescript: "^5.8.3",
    });
    const runtimeLock = JSON.parse(
      await readFile(join(workspaceRoot, "harness-next/runtime/package-lock.json"), "utf8"),
    ) as { packages?: Record<string, { devDependencies?: unknown; dependencies?: unknown }> };
    const runtimeRootLock = runtimeLock.packages?.[""];
    expect(runtimeRootLock?.devDependencies).toBeUndefined();
    expect(runtimeRootLock?.dependencies).toEqual(runtimePackage.dependencies);
    await expect(
      access(join(workspaceRoot, "harness-next/skills/harness-next/SKILL.md")),
    ).resolves.toBeUndefined();
    const [codexAdapter, claudeAdapter] = await Promise.all([
      readFile(join(workspaceRoot, ".agents/skills/harness-next/SKILL.md"), "utf8"),
      readFile(join(workspaceRoot, ".claude/skills/harness-next/SKILL.md"), "utf8"),
    ]);
    expect(codexAdapter).toBe(claudeAdapter);
    expect(codexAdapter).toContain("name: harness-next");
    expect(codexAdapter).toContain(
      "../../../harness-next/skills/harness-next/SKILL.md",
    );
    await expect(access(join(workspaceRoot, "harness-next/src"))).rejects.toThrow();
    expect((await stat(join(workspaceRoot, "harness-next/bin/harness-next"))).mode & 0o111).not.toBe(0);
    const installedManifest = JSON.parse(
      await readFile(join(workspaceRoot, "harness-next/installation.json"), "utf8"),
    ) as {
      schemaVersion?: number;
      layoutVersion?: number;
      harnessVersion?: string;
      managedEntries?: Record<string, unknown>;
      runtime?: { version?: string; hash?: string; stateSchemaVersion?: number };
    };
    expect(installedManifest).toMatchObject({
      schemaVersion: 1,
      layoutVersion: 1,
      harnessVersion: "0.1.0",
      managedEntries: {
        agents: true,
        claude: true,
        gitignore: true,
        codexSkill: true,
        claudeSkill: true,
      },
    });
    expect(installedManifest.runtime?.version).toBe("0.1.0");
    expect(installedManifest.runtime?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(installedManifest.runtime?.stateSchemaVersion).toBe(1);
    expect(resolveHarnessPaths({ projectRoot: workspaceRoot })).toMatchObject({
      projectRoot: workspaceRoot,
      workspaceRoot,
      harnessRoot: join(workspaceRoot, "harness-next"),
      runtimeRoot: join(workspaceRoot, "harness-next/runtime"),
      stateRoot: join(workspaceRoot, "harness-next/.state"),
    });
    const catalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "harness-next/generated/workflow-catalog.json"),
        "utf8",
      ),
    ) as { workflows: { path: string }[] };
    expect(catalog.workflows.every((workflow) => workflow.path.startsWith("workflows/"))).toBe(
      true,
    );
  });

  test("托管块位于顶部、保留原文且重复安装幂等", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-managed-"));
    await writeFile(join(workspaceRoot, "AGENTS.md"), "原始 Agent 规则\n", "utf8");
    await writeFile(join(workspaceRoot, "CLAUDE.md"), "原始 Claude 规则\n", "utf8");

    await installForTest(workspaceRoot);
    const second = await installForTest(workspaceRoot);

    expect(second.changed).toBe(false);
    expect(second.maintainedEntries).toEqual([]);
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const content = await readFile(join(workspaceRoot, name), "utf8");
      expect(content.startsWith("<!-- harness-next:start version=1 -->\n")).toBe(true);
      expect(content.match(/<!-- harness-next:start version=1 -->/gu)).toHaveLength(1);
      expect(content.match(/<!-- harness-next:end -->/gu)).toHaveLength(1);
      expect(content).toContain("必须遵循 Runtime 返回的当前 Step");
    }
    const gitignore = await readFile(join(workspaceRoot, ".gitignore"), "utf8");
    expect(gitignore.startsWith("# harness-next:start\n")).toBe(true);
    expect(gitignore.match(/# harness-next:start/gu)).toHaveLength(1);
    expect(gitignore.match(/# harness-next:end/gu)).toHaveLength(1);
    expect(await readFile(join(workspaceRoot, "AGENTS.md"), "utf8")).toContain("原始 Agent 规则\n");
    expect(await readFile(join(workspaceRoot, "CLAUDE.md"), "utf8")).toContain("原始 Claude 规则\n");
  });

  test("重复 install 将旧版安装原地迁移为项目级 Skill", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-migration-"));
    await installForTest(workspaceRoot);
    const installationPath = join(workspaceRoot, "harness-next/installation.json");
    await downgradeToLegacyInstallation(workspaceRoot);

    const result = await installForTest(workspaceRoot);

    expect(result.changed).toBe(true);
    expect(result.maintainedEntries).toEqual([]);
    await expect(
      access(join(workspaceRoot, "harness-next/skills/harness-next/SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, ".agents/skills/harness-next/SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, ".claude/skills/harness-next/SKILL.md")),
    ).resolves.toBeUndefined();
    const migratedManifest = JSON.parse(await readFile(installationPath, "utf8")) as {
      runtime?: { version?: string; hash?: string; stateSchemaVersion?: number };
    };
    expect(migratedManifest).toMatchObject({
      ...legacyManifest,
      managedEntries: {
        ...legacyManifest.managedEntries,
        codexSkill: true,
        claudeSkill: true,
      },
    });
    expect(migratedManifest.runtime?.version).toBe("0.1.0");
    expect(migratedManifest.runtime?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(migratedManifest.runtime?.stateSchemaVersion).toBe(1);
  });

  test("旧版安装迁移后继续重复 install 保持幂等", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-migration-idempotent-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyInstallation(workspaceRoot);
    await installForTest(workspaceRoot);
    const paths = [
      "harness-next/installation.json",
      "harness-next/skills/harness-next/SKILL.md",
      ".agents/skills/harness-next/SKILL.md",
      ".claude/skills/harness-next/SKILL.md",
    ];
    const before = await Promise.all(paths.map((path) => readFile(join(workspaceRoot, path), "utf8")));

    const result = await installForTest(workspaceRoot);

    expect(result.changed).toBe(false);
    expect(result.maintainedEntries).toEqual([]);
    await expect(
      Promise.all(paths.map((path) => readFile(join(workspaceRoot, path), "utf8"))),
    ).resolves.toEqual(before);
  });

  test("重复 install 会升级缺少 Runtime 元数据的旧安装", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-runtime-migration-"));
    await installForTest(workspaceRoot);
    const installationPath = join(workspaceRoot, "harness-next/installation.json");
    const manifest = JSON.parse(await readFile(installationPath, "utf8")) as Record<string, unknown>;
    delete manifest.runtime;
    await writeFile(installationPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const runtimePackagePath = join(workspaceRoot, "harness-next/runtime/package.json");
    const runtimePackage = JSON.parse(await readFile(runtimePackagePath, "utf8")) as Record<string, unknown>;
    runtimePackage.scripts = { test: "echo stale" };
    await writeFile(runtimePackagePath, `${JSON.stringify(runtimePackage, null, 2)}\n`, "utf8");

    const result = await installForTest(workspaceRoot);

    expect(result.changed).toBe(true);
    const upgradedRuntimePackage = JSON.parse(await readFile(runtimePackagePath, "utf8")) as {
      scripts?: unknown;
    };
    expect(upgradedRuntimePackage.scripts).toBeUndefined();
    const upgradedManifest = JSON.parse(await readFile(installationPath, "utf8")) as {
      runtime?: { version?: string; hash?: string; stateSchemaVersion?: number };
    };
    expect(upgradedManifest.runtime?.version).toBe("0.1.0");
    expect(upgradedManifest.runtime?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(upgradedManifest.runtime?.stateSchemaVersion).toBe(1);
  });

  test("运行中的 Run 会阻止 Runtime 升级并保留原文件", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-runtime-running-"));
    await installForTest(workspaceRoot);
    const installationPath = join(workspaceRoot, "harness-next/installation.json");
    const manifest = JSON.parse(await readFile(installationPath, "utf8")) as Record<string, unknown>;
    delete manifest.runtime;
    await writeFile(installationPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const runtimePackagePath = join(workspaceRoot, "harness-next/runtime/package.json");
    const beforeRuntime = await readFile(runtimePackagePath, "utf8");
    await writeFile(runtimePackagePath, `${beforeRuntime}\n`, "utf8");
    const staleRuntime = await readFile(runtimePackagePath, "utf8");
    await mkdir(join(workspaceRoot, "harness-next/.state/runs/run-1"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "harness-next/.state/runs/run-1/state.json"),
      JSON.stringify({ status: "running" }),
      "utf8",
    );

    await expect(installForTest(workspaceRoot)).rejects.toThrow(/运行中的 Run/u);
    await expect(readFile(runtimePackagePath, "utf8")).resolves.toBe(staleRuntime);
  });

  test("旧版安装迁移遇到同名规范入口时不覆盖也不产生部分修改", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-migration-conflict-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyInstallation(workspaceRoot);
    const canonicalPath = join(workspaceRoot, "harness-next/skills/harness-next/SKILL.md");
    await mkdir(join(workspaceRoot, "harness-next/skills/harness-next"), { recursive: true });
    await writeFile(canonicalPath, "用户定义的同名规范入口\n", "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Next 管理/u,
    );

    await expect(readFile(canonicalPath, "utf8")).resolves.toBe("用户定义的同名规范入口\n");
    await expect(
      readFile(join(workspaceRoot, "harness-next/installation.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(legacyManifest, null, 2)}\n`);
    await expect(
      access(join(workspaceRoot, ".agents/skills/harness-next/SKILL.md")),
    ).rejects.toThrow();
    await expect(
      access(join(workspaceRoot, ".claude/skills/harness-next/SKILL.md")),
    ).rejects.toThrow();
  });

  test("旧版安装迁移 preflight 失败时回滚清单和项目级 Skill", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-migration-rollback-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyInstallation(workspaceRoot);
    await writeFile(
      join(workspaceRoot, "harness-next/generated/workflow-catalog.json"),
      "{}\n",
      "utf8",
    );
    const runtimePackagePath = join(workspaceRoot, "harness-next/runtime/package.json");
    const runtimePackage = await readFile(runtimePackagePath, "utf8");
    await writeFile(runtimePackagePath, `${runtimePackage}\n`, "utf8");
    const staleRuntime = await readFile(runtimePackagePath, "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow();

    await expect(
      readFile(join(workspaceRoot, "harness-next/installation.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(legacyManifest, null, 2)}\n`);
    await expect(readFile(runtimePackagePath, "utf8")).resolves.toBe(staleRuntime);
    for (const path of [
      "harness-next/skills/harness-next/SKILL.md",
      ".agents/skills/harness-next/SKILL.md",
      ".claude/skills/harness-next/SKILL.md",
    ]) {
      await expect(access(join(workspaceRoot, path))).rejects.toThrow();
    }
  });

  test("已有同名项目级 Skill 时拒绝覆盖且不产生部分安装", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-conflict-"));
    const skillPath = join(workspaceRoot, ".agents/skills/harness-next/SKILL.md");
    await mkdir(join(workspaceRoot, ".agents/skills/harness-next"), { recursive: true });
    await writeFile(skillPath, "用户定义的 Harness Skill\n", "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Next 管理/u,
    );

    await expect(readFile(skillPath, "utf8")).resolves.toBe("用户定义的 Harness Skill\n");
    await expect(access(join(workspaceRoot, "harness-next"))).rejects.toThrow();
    await expect(access(join(workspaceRoot, "AGENTS.md"))).rejects.toThrow();
    await expect(access(join(workspaceRoot, "CLAUDE.md"))).rejects.toThrow();
  });

  test("项目级 Skill 文件位置被目录占用时拒绝安装", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-directory-"));
    const skillPath = join(workspaceRoot, ".claude/skills/harness-next/SKILL.md");
    await mkdir(skillPath, { recursive: true });

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Next 管理/u,
    );
    expect((await stat(skillPath)).isDirectory()).toBe(true);
    await expect(access(join(workspaceRoot, "harness-next"))).rejects.toThrow();
  });

  test("重复安装不覆盖被修改的项目级 Skill Adapter", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-repeat-"));
    await installForTest(workspaceRoot);
    const skillPath = join(workspaceRoot, ".claude/skills/harness-next/SKILL.md");
    await writeFile(skillPath, "用户修改的 Adapter\n", "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Next 管理/u,
    );
    await expect(readFile(skillPath, "utf8")).resolves.toBe("用户修改的 Adapter\n");
  });

  test.each([
    ["只有开始标记", "<!-- harness-next:start version=1 -->\n损坏内容\n"],
    [
      "存在重复托管块",
      "<!-- harness-next:start version=1 -->\nA\n<!-- harness-next:end -->\n" +
        "<!-- harness-next:start version=1 -->\nB\n<!-- harness-next:end -->\n",
    ],
    ["存在旧版未知标记", "<!-- harness-next:start -->\n旧内容\n<!-- harness-next:end -->\n"],
  ])("%s 时拒绝安装且不产生部分修改", async (_name, source) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-invalid-managed-"));
    await writeFile(join(workspaceRoot, "AGENTS.md"), "原始 Agent 规则\n", "utf8");
    await writeFile(join(workspaceRoot, "CLAUDE.md"), source, "utf8");

    await expect(
      installForTest(workspaceRoot),
    ).rejects.toThrow(/托管块/u);

    await expect(readFile(join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe(
      "原始 Agent 规则\n",
    );
    await expect(readFile(join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe(source);
    await expect(access(join(workspaceRoot, "harness-next"))).rejects.toThrow();
  });

  test("替换托管块时不删除结束标记后紧邻的用户正文", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-adjacent-content-"));
    await installForTest(workspaceRoot);
    const source =
      "<!-- harness-next:start version=1 -->\r\n旧托管内容\r\n" +
      "<!-- harness-next:end -->用户正文";
    await writeFile(join(workspaceRoot, "AGENTS.md"), source, "utf8");

    await installForTest(workspaceRoot);

    const installed = await readFile(join(workspaceRoot, "AGENTS.md"), "utf8");
    expect(installed.endsWith("用户正文")).toBe(true);
  });

  test("wrapper 从任意子目录运行项目内 preflight 和 route", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-wrapper-"));
    await installForTest(workspaceRoot);
    await symlink(join(sourceRoot, "node_modules"), join(workspaceRoot, "harness-next/runtime/node_modules"));
    const nested = join(workspaceRoot, "src/nested");
    await mkdir(nested, { recursive: true });
    const wrapper = join(workspaceRoot, "harness-next/bin/harness-next");

    const preflight = await execFileAsync(wrapper, ["preflight"], { cwd: nested });
    const route = await execFileAsync(wrapper, ["route"], { cwd: nested });

    expect(JSON.parse(preflight.stdout)).toEqual({
      status: "ready",
      projectRoot: ".",
      harnessRoot: "harness-next",
      recoverableRun: false,
    });
    expect(route.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(route.stdout)).toMatchObject({
      kind: "harness-next.router-directive",
      routerSkillPath: "harness-next/skills/workflow-router/SKILL.md",
      catalogPath: "harness-next/generated/workflow-catalog.json",
    });

    await writeFile(join(workspaceRoot, "input.json"), JSON.stringify({ request: "实现功能" }));
    const started = JSON.parse(
      (
        await execFileAsync(
          wrapper,
          ["start", "workflows/node-typescript-development/workflow.yaml", "local-run", "input.json"],
          { cwd: nested },
        )
      ).stdout,
    ) as { runId: string; step?: { skillPath?: string } };
    expect(started.step?.skillPath).toBe("harness-next/skills/analyze-node-change/SKILL.md");
    await expect(
      access(join(workspaceRoot, "harness-next/.state/runs", started.runId, "state.json")),
    ).resolves.toBeUndefined();
  });

  test("项目移动后启动器仍从自身位置解析 Runtime", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-movable-"));
    await installForTest(workspaceRoot);
    await symlink(join(sourceRoot, "node_modules"), join(workspaceRoot, "harness-next/runtime/node_modules"));
    const movedRoot = `${workspaceRoot}-moved`;

    await rename(workspaceRoot, movedRoot);

    const result = await execFileAsync(join(movedRoot, "harness-next/bin/harness-next"), ["preflight"], {
      cwd: movedRoot,
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "ready", projectRoot: "." });
  });

  test("重复安装保留用户修改并报告冲突", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-conflict-"));
    await installForTest(workspaceRoot);
    const workflowPath = join(workspaceRoot, "harness-next/workflows/node-typescript-development/workflow.yaml");
    await writeFile(workflowPath, "用户自定义 Workflow\n", "utf8");

    const result = await installForTest(workspaceRoot);

    expect(await readFile(workflowPath, "utf8")).toBe("用户自定义 Workflow\n");
    expect(result.maintainedEntries).toContain(
      "workflows/node-typescript-development/workflow.yaml",
    );
  });

  test("preflight 在 Catalog 过期或托管入口缺失时 fail closed", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-preflight-"));
    await installForTest(workspaceRoot);
    const workflowPath = join(
      workspaceRoot,
      "harness-next/workflows/node-typescript-development/workflow.yaml",
    );
    await writeFile(workflowPath, `${await readFile(workflowPath, "utf8")}\n`, "utf8");

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow(
      /Catalog.*过期/u,
    );

    await writeFile(join(workspaceRoot, "AGENTS.md"), "项目规则\n", "utf8");
    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow(
      /AGENTS\.md.*托管块/u,
    );
  });

  test("preflight 在项目级 Skill Adapter 被篡改时 fail closed", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-skill-preflight-"));
    await installForTest(workspaceRoot);
    const adapterPath = join(workspaceRoot, ".agents/skills/harness-next/SKILL.md");
    await writeFile(adapterPath, "用户定义的同名 Skill\n", "utf8");

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Next 管理/u,
    );
  });

  test("preflight 报告可恢复的运行中 Run", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-recoverable-"));
    await installForTest(workspaceRoot);
    const runRoot = join(workspaceRoot, "harness-next/.state/runs/recoverable-run");
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "state.json"), JSON.stringify({ status: "running" }));

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).resolves.toMatchObject({
      status: "ready",
      recoverableRun: true,
    });
  });

  test("preflight 遇到损坏 Run 状态或非文件 Runtime 入口时失败", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-invalid-preflight-"));
    await installForTest(workspaceRoot);
    const runRoot = join(workspaceRoot, "harness-next/.state/runs/invalid-run");
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "state.json"), "{invalid json", "utf8");

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow();

    await writeFile(join(runRoot, "state.json"), JSON.stringify({ status: "completed" }), "utf8");
    const packagePath = join(workspaceRoot, "harness-next/runtime/package.json");
    await rename(packagePath, `${packagePath}.backup`);
    await mkdir(packagePath);
    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow(
      /runtime\/package\.json.*普通文件/u,
    );
  });

  test("安装后的 Router 和 Check 只调用项目本地 Runtime", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-next-local-router-"));
    await installForTest(workspaceRoot);

    const router = await readFile(
      join(workspaceRoot, "harness-next/skills/workflow-router/SKILL.md"),
      "utf8",
    );
    const qualityGate = await readFile(
      join(workspaceRoot, "harness-next/checks/node-quality-gate/CHECK.md"),
      "utf8",
    );
    const standardsSkill = await readFile(
      join(workspaceRoot, "harness-next/skills/load-node-typescript-standards/SKILL.md"),
      "utf8",
    );

    expect(router).toContain("./harness-next/bin/harness-next preflight");
    expect(router).toContain("./harness-next/bin/harness-next start");
    expect(router).toContain("harness-next/.state/tmp/");
    expect(router).not.toContain("npm run workflow:");
    expect(qualityGate).toContain("runtime/dist/cli.js");
    expect(qualityGate).not.toContain("args: [dist/cli.js");
    expect(standardsSkill).toContain(
      "harness-next/workflows/node-typescript-standards/STANDARDS.md",
    );
  });
});

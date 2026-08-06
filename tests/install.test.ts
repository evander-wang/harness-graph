import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
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
import { hashRuntimeArtifacts } from "../src/installation/runtime.js";

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
    join(workspaceRoot, "harness-graph/installation.json"),
    `${JSON.stringify(legacyManifest, null, 2)}\n`,
    "utf8",
  );
  await Promise.all([
    rm(join(workspaceRoot, "harness-graph/skills/harness-graph"), { recursive: true }),
    rm(join(workspaceRoot, ".agents/skills/harness-graph"), { recursive: true }),
    rm(join(workspaceRoot, ".claude/skills/harness-graph"), { recursive: true }),
  ]);
}

function legacyBrand(source: string): string {
  return source
    .replaceAll("Harness Graph", "Harness Next")
    .replaceAll("HARNESS_GRAPH", "HARNESS_NEXT")
    .replaceAll("harness-graph", "harness-next");
}

function legacyAdapterSource(): string {
  return [
    "---\n",
    "name: harness-next\n",
    "description: Run this project's installed Harness Next Workflow. ",
    "Use when the user invokes harness-next, names a Workflow or Alias, ",
    "asks to run or recover a Workflow, or requests a project code or configuration change.\n",
    "---\n\n",
    "Read `../../../harness-next/skills/harness-next/SKILL.md` completely and follow it ",
    "for the current user request.\n",
  ].join("");
}

async function rewriteTreeToLegacyBrand(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await rewriteTreeToLegacyBrand(path);
    } else if (entry.isFile()) {
      await writeFile(path, legacyBrand(await readFile(path, "utf8")), "utf8");
    }
  }
}

async function downgradeToLegacyBrandInstallation(workspaceRoot: string): Promise<void> {
  const currentRoot = join(workspaceRoot, "harness-graph");
  const legacyRoot = join(workspaceRoot, "harness-next");
  await rename(currentRoot, legacyRoot);
  await rewriteTreeToLegacyBrand(legacyRoot);
  await rename(join(legacyRoot, "bin/harness-graph"), join(legacyRoot, "bin/harness-next"));
  await rename(
    join(legacyRoot, "skills/harness-graph"),
    join(legacyRoot, "skills/harness-next"),
  );
  const manifestPath = join(legacyRoot, "installation.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.layoutVersion = 1;
  const runtime = manifest.runtime as Record<string, unknown>;
  runtime.hash = await hashRuntimeArtifacts(join(legacyRoot, "runtime"));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const host of [".agents", ".claude"]) {
    const currentSkillRoot = join(workspaceRoot, host, "skills/harness-graph");
    const legacySkillRoot = join(workspaceRoot, host, "skills/harness-next");
    await rename(currentSkillRoot, legacySkillRoot);
    const skillPath = join(legacySkillRoot, "SKILL.md");
    await writeFile(skillPath, legacyAdapterSource(), "utf8");
  }
  for (const name of ["AGENTS.md", "CLAUDE.md", ".gitignore"]) {
    const path = join(workspaceRoot, name);
    await writeFile(path, legacyBrand(await readFile(path, "utf8")), "utf8");
  }
}

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build", "--silent"], { cwd: sourceRoot });
});

describe("installHarnessProject", () => {
  test("新安装使用 Harness Graph layout v2", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-install-"));

    const result = await installForTest(workspaceRoot);

    expect(result).toMatchObject({
      status: "installed",
      changed: true,
      projectRoot: ".",
      harnessRoot: "harness-graph",
      command: "./harness-graph/bin/harness-graph route",
    });
    await expect(
      access(join(workspaceRoot, "harness-graph/bin/harness-graph")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, "harness-graph/runtime/dist/web/index.html")),
    ).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-next"))).rejects.toThrow();
    const manifest = JSON.parse(
      await readFile(join(workspaceRoot, "harness-graph/installation.json"), "utf8"),
    ) as { layoutVersion?: number };
    expect(manifest.layoutVersion).toBe(2);
    const runtimePackage = JSON.parse(
      await readFile(join(workspaceRoot, "harness-graph/runtime/package.json"), "utf8"),
    ) as { name?: string; bin?: Record<string, string> };
    expect(runtimePackage).toMatchObject({
      name: "@jichaowang/harness-graph",
      bin: { "harness-graph": "dist/cli.js" },
    });
    const adapter = await readFile(
      join(workspaceRoot, ".agents/skills/harness-graph/SKILL.md"),
      "utf8",
    );
    expect(adapter).toContain("name: harness-graph");
    expect(adapter).toContain("../../../harness-graph/skills/harness-graph/SKILL.md");
  });

  test("install 将旧 Harness Next 布局迁移为 Harness Graph 并保留用户资产", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-brand-migration-"));
    await installForTest(workspaceRoot);
    const workflowPath = join(
      workspaceRoot,
      "harness-graph/workflows/node-typescript-development/workflow.yaml",
    );
    await writeFile(workflowPath, `${await readFile(workflowPath, "utf8")}# 用户修改保留\n`, "utf8");
    await downgradeToLegacyBrandInstallation(workspaceRoot);

    const result = await installForTest(workspaceRoot);

    expect(result).toMatchObject({
      changed: true,
      harnessRoot: "harness-graph",
      command: "./harness-graph/bin/harness-graph route",
    });
    await expect(access(join(workspaceRoot, "harness-next"))).rejects.toThrow();
    await expect(
      readFile(
        join(workspaceRoot, "harness-graph/workflows/node-typescript-development/workflow.yaml"),
        "utf8",
      ),
    ).resolves.toContain("# 用户修改保留");
    await expect(
      access(join(workspaceRoot, ".agents/skills/harness-next/SKILL.md")),
    ).rejects.toThrow();
    await expect(
      access(join(workspaceRoot, ".claude/skills/harness-next/SKILL.md")),
    ).rejects.toThrow();
    expect(await readFile(join(workspaceRoot, "AGENTS.md"), "utf8"))
      .not.toContain("harness-next");
    const manifest = JSON.parse(
      await readFile(join(workspaceRoot, "harness-graph/installation.json"), "utf8"),
    ) as { layoutVersion?: number };
    expect(manifest.layoutVersion).toBe(2);
  });

  test("旧布局缺少规范入口 Skill 时从新的源码路径补回", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-missing-canonical-skill-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyBrandInstallation(workspaceRoot);
    await rm(join(workspaceRoot, "harness-next/skills/harness-next"), { recursive: true });

    await installForTest(workspaceRoot);

    await expect(
      access(join(workspaceRoot, "harness-graph/skills/harness-graph/SKILL.md")),
    ).resolves.toBeUndefined();
  });

  test("旧布局存在运行中 Run 时拒绝迁移并保留原安装", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-running-migration-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyBrandInstallation(workspaceRoot);
    const runRoot = join(workspaceRoot, "harness-next/.state/runs/running-migration");
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "state.json"), JSON.stringify({ status: "running" }), "utf8");
    const agentsBefore = await readFile(join(workspaceRoot, "AGENTS.md"), "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(/运行中的 Run/u);

    await expect(access(join(workspaceRoot, "harness-next"))).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-graph"))).rejects.toThrow();
    await expect(readFile(join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe(agentsBefore);
  });

  test("新旧 Harness Root 并存时拒绝迁移", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-root-conflict-"));
    await installForTest(workspaceRoot);
    await mkdir(join(workspaceRoot, "harness-next"));

    await expect(installForTest(workspaceRoot)).rejects.toThrow(/同时存在/u);
  });

  test("安装到空工作区并只复制可提交运行资产", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-install-"));

    const result = await installForTest(workspaceRoot);

    expect(result).toMatchObject({
      status: "installed",
      changed: true,
      projectRoot: ".",
      harnessRoot: "harness-graph",
      command: "./harness-graph/bin/harness-graph route",
      maintainedEntries: [],
    });
    await expect(access(join(workspaceRoot, "harness-graph/workflows/node-typescript-development/workflow.yaml"))).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, "harness-graph/workflows/change-execution-policy/workflow.yaml")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, "harness-graph/skills/load-change-execution-policy/SKILL.md")),
    ).resolves.toBeUndefined();
    const installedCatalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "harness-graph/generated/workflow-catalog.json"),
        "utf8",
      ),
    ) as { entryWorkflows?: string[]; workflows?: Array<{ name?: string }> };
    expect(installedCatalog.entryWorkflows).not.toContain("change-execution-policy");
    expect(installedCatalog.workflows?.map((workflow) => workflow.name)).toContain(
      "change-execution-policy",
    );
    await expect(access(join(workspaceRoot, "harness-graph/models/node-change-request.schema.json"))).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-graph/runtime/dist/cli.js"))).resolves.toBeUndefined();
    await expect(access(join(workspaceRoot, "harness-graph/runtime/package-lock.json"))).resolves.toBeUndefined();
    const runtimePackage = JSON.parse(
      await readFile(join(workspaceRoot, "harness-graph/runtime/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runtimePackage).toMatchObject({
      name: "@jichaowang/harness-graph",
      type: "module",
      bin: { "harness-graph": "dist/cli.js" },
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
      await readFile(join(workspaceRoot, "harness-graph/runtime/package-lock.json"), "utf8"),
    ) as { packages?: Record<string, { devDependencies?: unknown; dependencies?: unknown }> };
    const runtimeRootLock = runtimeLock.packages?.[""];
    expect(runtimeRootLock?.devDependencies).toBeUndefined();
    expect(runtimeRootLock?.dependencies).toEqual(runtimePackage.dependencies);
    await expect(
      access(join(workspaceRoot, "harness-graph/skills/harness-graph/SKILL.md")),
    ).resolves.toBeUndefined();
    const [codexAdapter, claudeAdapter] = await Promise.all([
      readFile(join(workspaceRoot, ".agents/skills/harness-graph/SKILL.md"), "utf8"),
      readFile(join(workspaceRoot, ".claude/skills/harness-graph/SKILL.md"), "utf8"),
    ]);
    expect(codexAdapter).toBe(claudeAdapter);
    expect(codexAdapter).toContain("name: harness-graph");
    expect(codexAdapter).toContain(
      "../../../harness-graph/skills/harness-graph/SKILL.md",
    );
    await expect(access(join(workspaceRoot, "harness-graph/src"))).rejects.toThrow();
    expect((await stat(join(workspaceRoot, "harness-graph/bin/harness-graph"))).mode & 0o111).not.toBe(0);
    const installedManifest = JSON.parse(
      await readFile(join(workspaceRoot, "harness-graph/installation.json"), "utf8"),
    ) as {
      schemaVersion?: number;
      layoutVersion?: number;
      harnessVersion?: string;
      managedEntries?: Record<string, unknown>;
      runtime?: { version?: string; hash?: string; stateSchemaVersion?: number };
    };
    expect(installedManifest).toMatchObject({
      schemaVersion: 1,
      layoutVersion: 2,
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
      harnessRoot: join(workspaceRoot, "harness-graph"),
      runtimeRoot: join(workspaceRoot, "harness-graph/runtime"),
      stateRoot: join(workspaceRoot, "harness-graph/.state"),
    });
    const catalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "harness-graph/generated/workflow-catalog.json"),
        "utf8",
      ),
    ) as { workflows: { path: string }[] };
    expect(catalog.workflows.every((workflow) => workflow.path.startsWith("workflows/"))).toBe(
      true,
    );
  });

  test("托管块位于顶部、保留原文且重复安装幂等", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-managed-"));
    await writeFile(join(workspaceRoot, "AGENTS.md"), "原始 Agent 规则\n", "utf8");
    await writeFile(join(workspaceRoot, "CLAUDE.md"), "原始 Claude 规则\n", "utf8");

    await installForTest(workspaceRoot);
    const second = await installForTest(workspaceRoot);

    expect(second.changed).toBe(false);
    expect(second.maintainedEntries).toEqual([]);
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const content = await readFile(join(workspaceRoot, name), "utf8");
      expect(content.startsWith("<!-- harness-graph:start version=1 -->\n")).toBe(true);
      expect(content.match(/<!-- harness-graph:start version=1 -->/gu)).toHaveLength(1);
      expect(content.match(/<!-- harness-graph:end -->/gu)).toHaveLength(1);
      expect(content).toContain("必须遵循 Runtime 返回的当前 Step");
    }
    const gitignore = await readFile(join(workspaceRoot, ".gitignore"), "utf8");
    expect(gitignore.startsWith("# harness-graph:start\n")).toBe(true);
    expect(gitignore.match(/# harness-graph:start/gu)).toHaveLength(1);
    expect(gitignore.match(/# harness-graph:end/gu)).toHaveLength(1);
    expect(await readFile(join(workspaceRoot, "AGENTS.md"), "utf8")).toContain("原始 Agent 规则\n");
    expect(await readFile(join(workspaceRoot, "CLAUDE.md"), "utf8")).toContain("原始 Claude 规则\n");
  });

  test("重复 install 将旧版安装原地迁移为项目级 Skill", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-migration-"));
    await installForTest(workspaceRoot);
    const installationPath = join(workspaceRoot, "harness-graph/installation.json");
    await downgradeToLegacyInstallation(workspaceRoot);

    const result = await installForTest(workspaceRoot);

    expect(result.changed).toBe(true);
    expect(result.maintainedEntries).toEqual([]);
    await expect(
      access(join(workspaceRoot, "harness-graph/skills/harness-graph/SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, ".agents/skills/harness-graph/SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(workspaceRoot, ".claude/skills/harness-graph/SKILL.md")),
    ).resolves.toBeUndefined();
    const migratedManifest = JSON.parse(await readFile(installationPath, "utf8")) as {
      runtime?: { version?: string; hash?: string; stateSchemaVersion?: number };
    };
    expect(migratedManifest).toMatchObject({
      ...legacyManifest,
      layoutVersion: 2,
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
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-migration-idempotent-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyInstallation(workspaceRoot);
    await installForTest(workspaceRoot);
    const paths = [
      "harness-graph/installation.json",
      "harness-graph/skills/harness-graph/SKILL.md",
      ".agents/skills/harness-graph/SKILL.md",
      ".claude/skills/harness-graph/SKILL.md",
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
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-runtime-migration-"));
    await installForTest(workspaceRoot);
    const installationPath = join(workspaceRoot, "harness-graph/installation.json");
    const manifest = JSON.parse(await readFile(installationPath, "utf8")) as Record<string, unknown>;
    delete manifest.runtime;
    await writeFile(installationPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const runtimePackagePath = join(workspaceRoot, "harness-graph/runtime/package.json");
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
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-runtime-running-"));
    await installForTest(workspaceRoot);
    const installationPath = join(workspaceRoot, "harness-graph/installation.json");
    const manifest = JSON.parse(await readFile(installationPath, "utf8")) as Record<string, unknown>;
    delete manifest.runtime;
    await writeFile(installationPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const runtimePackagePath = join(workspaceRoot, "harness-graph/runtime/package.json");
    const beforeRuntime = await readFile(runtimePackagePath, "utf8");
    await writeFile(runtimePackagePath, `${beforeRuntime}\n`, "utf8");
    const staleRuntime = await readFile(runtimePackagePath, "utf8");
    await mkdir(join(workspaceRoot, "harness-graph/.state/runs/run-1"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "harness-graph/.state/runs/run-1/state.json"),
      JSON.stringify({ status: "running" }),
      "utf8",
    );

    await expect(installForTest(workspaceRoot)).rejects.toThrow(/运行中的 Run/u);
    await expect(readFile(runtimePackagePath, "utf8")).resolves.toBe(staleRuntime);
  });

  test("旧版安装迁移遇到同名规范入口时不覆盖也不产生部分修改", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-migration-conflict-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyInstallation(workspaceRoot);
    const canonicalPath = join(workspaceRoot, "harness-graph/skills/harness-graph/SKILL.md");
    await mkdir(join(workspaceRoot, "harness-graph/skills/harness-graph"), { recursive: true });
    await writeFile(canonicalPath, "用户定义的同名规范入口\n", "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Graph 管理/u,
    );

    await expect(readFile(canonicalPath, "utf8")).resolves.toBe("用户定义的同名规范入口\n");
    await expect(
      readFile(join(workspaceRoot, "harness-graph/installation.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(legacyManifest, null, 2)}\n`);
    await expect(
      access(join(workspaceRoot, ".agents/skills/harness-graph/SKILL.md")),
    ).rejects.toThrow();
    await expect(
      access(join(workspaceRoot, ".claude/skills/harness-graph/SKILL.md")),
    ).rejects.toThrow();
  });

  test("旧版安装迁移 preflight 失败时回滚清单和项目级 Skill", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-migration-rollback-"));
    await installForTest(workspaceRoot);
    await downgradeToLegacyInstallation(workspaceRoot);
    await writeFile(
      join(workspaceRoot, "harness-graph/generated/workflow-catalog.json"),
      "{}\n",
      "utf8",
    );
    const runtimePackagePath = join(workspaceRoot, "harness-graph/runtime/package.json");
    const runtimePackage = await readFile(runtimePackagePath, "utf8");
    await writeFile(runtimePackagePath, `${runtimePackage}\n`, "utf8");
    const staleRuntime = await readFile(runtimePackagePath, "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow();

    await expect(
      readFile(join(workspaceRoot, "harness-graph/installation.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(legacyManifest, null, 2)}\n`);
    await expect(readFile(runtimePackagePath, "utf8")).resolves.toBe(staleRuntime);
    for (const path of [
      "harness-graph/skills/harness-graph/SKILL.md",
      ".agents/skills/harness-graph/SKILL.md",
      ".claude/skills/harness-graph/SKILL.md",
    ]) {
      await expect(access(join(workspaceRoot, path))).rejects.toThrow();
    }
  });

  test("已有同名项目级 Skill 时拒绝覆盖且不产生部分安装", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-conflict-"));
    const skillPath = join(workspaceRoot, ".agents/skills/harness-graph/SKILL.md");
    await mkdir(join(workspaceRoot, ".agents/skills/harness-graph"), { recursive: true });
    await writeFile(skillPath, "用户定义的 Harness Skill\n", "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Graph 管理/u,
    );

    await expect(readFile(skillPath, "utf8")).resolves.toBe("用户定义的 Harness Skill\n");
    await expect(access(join(workspaceRoot, "harness-graph"))).rejects.toThrow();
    await expect(access(join(workspaceRoot, "AGENTS.md"))).rejects.toThrow();
    await expect(access(join(workspaceRoot, "CLAUDE.md"))).rejects.toThrow();
  });

  test("项目级 Skill 文件位置被目录占用时拒绝安装", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-directory-"));
    const skillPath = join(workspaceRoot, ".claude/skills/harness-graph/SKILL.md");
    await mkdir(skillPath, { recursive: true });

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Graph 管理/u,
    );
    expect((await stat(skillPath)).isDirectory()).toBe(true);
    await expect(access(join(workspaceRoot, "harness-graph"))).rejects.toThrow();
  });

  test("重复安装不覆盖被修改的项目级 Skill Adapter", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-repeat-"));
    await installForTest(workspaceRoot);
    const skillPath = join(workspaceRoot, ".claude/skills/harness-graph/SKILL.md");
    await writeFile(skillPath, "用户修改的 Adapter\n", "utf8");

    await expect(installForTest(workspaceRoot)).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Graph 管理/u,
    );
    await expect(readFile(skillPath, "utf8")).resolves.toBe("用户修改的 Adapter\n");
  });

  test.each([
    ["只有开始标记", "<!-- harness-graph:start version=1 -->\n损坏内容\n"],
    [
      "存在重复托管块",
      "<!-- harness-graph:start version=1 -->\nA\n<!-- harness-graph:end -->\n" +
        "<!-- harness-graph:start version=1 -->\nB\n<!-- harness-graph:end -->\n",
    ],
    ["存在旧版未知标记", "<!-- harness-graph:start -->\n旧内容\n<!-- harness-graph:end -->\n"],
  ])("%s 时拒绝安装且不产生部分修改", async (_name, source) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-invalid-managed-"));
    await writeFile(join(workspaceRoot, "AGENTS.md"), "原始 Agent 规则\n", "utf8");
    await writeFile(join(workspaceRoot, "CLAUDE.md"), source, "utf8");

    await expect(
      installForTest(workspaceRoot),
    ).rejects.toThrow(/托管块/u);

    await expect(readFile(join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe(
      "原始 Agent 规则\n",
    );
    await expect(readFile(join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe(source);
    await expect(access(join(workspaceRoot, "harness-graph"))).rejects.toThrow();
  });

  test("替换托管块时不删除结束标记后紧邻的用户正文", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-adjacent-content-"));
    await installForTest(workspaceRoot);
    const source =
      "<!-- harness-graph:start version=1 -->\r\n旧托管内容\r\n" +
      "<!-- harness-graph:end -->用户正文";
    await writeFile(join(workspaceRoot, "AGENTS.md"), source, "utf8");

    await installForTest(workspaceRoot);

    const installed = await readFile(join(workspaceRoot, "AGENTS.md"), "utf8");
    expect(installed.endsWith("用户正文")).toBe(true);
  });

  test("wrapper 从任意子目录运行项目内 preflight 和 route", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-wrapper-"));
    await installForTest(workspaceRoot);
    await symlink(join(sourceRoot, "node_modules"), join(workspaceRoot, "harness-graph/runtime/node_modules"));
    const nested = join(workspaceRoot, "src/nested");
    await mkdir(nested, { recursive: true });
    const wrapper = join(workspaceRoot, "harness-graph/bin/harness-graph");

    const preflight = await execFileAsync(wrapper, ["preflight"], { cwd: nested });
    const route = await execFileAsync(wrapper, ["route"], { cwd: nested });

    expect(JSON.parse(preflight.stdout)).toEqual({
      status: "ready",
      projectRoot: ".",
      harnessRoot: "harness-graph",
      recoverableRun: false,
    });
    expect(route.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(route.stdout)).toMatchObject({
      kind: "harness-graph.router-directive",
      routerSkillPath: "harness-graph/skills/workflow-router/SKILL.md",
      catalogPath: "harness-graph/generated/workflow-catalog.json",
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
    expect(started.step?.skillPath).toBe("harness-graph/skills/analyze-node-change/SKILL.md");
    await expect(
      access(join(workspaceRoot, "harness-graph/.state/runs", started.runId, "state.json")),
    ).resolves.toBeUndefined();
  });

  test("项目移动后启动器仍从自身位置解析 Runtime", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-movable-"));
    await installForTest(workspaceRoot);
    await symlink(join(sourceRoot, "node_modules"), join(workspaceRoot, "harness-graph/runtime/node_modules"));
    const movedRoot = `${workspaceRoot}-moved`;

    await rename(workspaceRoot, movedRoot);

    const result = await execFileAsync(join(movedRoot, "harness-graph/bin/harness-graph"), ["preflight"], {
      cwd: movedRoot,
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "ready", projectRoot: "." });
  });

  test("重复安装保留用户修改并报告冲突", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-conflict-"));
    await installForTest(workspaceRoot);
    const workflowPath = join(workspaceRoot, "harness-graph/workflows/node-typescript-development/workflow.yaml");
    await writeFile(workflowPath, "用户自定义 Workflow\n", "utf8");

    const result = await installForTest(workspaceRoot);

    expect(await readFile(workflowPath, "utf8")).toBe("用户自定义 Workflow\n");
    expect(result.maintainedEntries).toContain(
      "workflows/node-typescript-development/workflow.yaml",
    );
  });

  test("preflight 在 Catalog 过期或托管入口缺失时 fail closed", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-preflight-"));
    await installForTest(workspaceRoot);
    const workflowPath = join(
      workspaceRoot,
      "harness-graph/workflows/node-typescript-development/workflow.yaml",
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
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-skill-preflight-"));
    await installForTest(workspaceRoot);
    const adapterPath = join(workspaceRoot, ".agents/skills/harness-graph/SKILL.md");
    await writeFile(adapterPath, "用户定义的同名 Skill\n", "utf8");

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow(
      /项目级 Skill 已存在且不受 Harness Graph 管理/u,
    );
  });

  test("preflight 报告可恢复的运行中 Run", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-recoverable-"));
    await installForTest(workspaceRoot);
    const runRoot = join(workspaceRoot, "harness-graph/.state/runs/recoverable-run");
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "state.json"), JSON.stringify({ status: "running" }));

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).resolves.toMatchObject({
      status: "ready",
      recoverableRun: true,
    });
  });

  test("preflight 遇到损坏 Run 状态或非文件 Runtime 入口时失败", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-invalid-preflight-"));
    await installForTest(workspaceRoot);
    const runRoot = join(workspaceRoot, "harness-graph/.state/runs/invalid-run");
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "state.json"), "{invalid json", "utf8");

    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow();

    await writeFile(join(runRoot, "state.json"), JSON.stringify({ status: "completed" }), "utf8");
    const packagePath = join(workspaceRoot, "harness-graph/runtime/package.json");
    await rename(packagePath, `${packagePath}.backup`);
    await mkdir(packagePath);
    await expect(checkHarnessProject({ projectRoot: workspaceRoot })).rejects.toThrow(
      /runtime\/package\.json.*普通文件/u,
    );
  });

  test("安装后的 Router 和 Check 只调用项目本地 Runtime", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-local-router-"));
    await installForTest(workspaceRoot);

    const router = await readFile(
      join(workspaceRoot, "harness-graph/skills/workflow-router/SKILL.md"),
      "utf8",
    );
    const qualityGate = await readFile(
      join(workspaceRoot, "harness-graph/checks/node-quality-gate/CHECK.md"),
      "utf8",
    );
    const standardsSkill = await readFile(
      join(workspaceRoot, "harness-graph/skills/load-node-typescript-standards/SKILL.md"),
      "utf8",
    );

    expect(router).toContain("./harness-graph/bin/harness-graph preflight");
    expect(router).toContain("./harness-graph/bin/harness-graph start");
    expect(router).toContain("harness-graph/.state/tmp/");
    expect(router).toContain("不写 Step Result，也不执行 `continue`");
    expect(router).toContain("复用相同的 `executionKey`");
    expect(router).toContain("无法通过用户回答继续时才提交 `blocked`");
    expect(router).not.toContain("npm run workflow:");
    expect(qualityGate).toContain("runtime/dist/cli.js");
    expect(qualityGate).not.toContain("args: [dist/cli.js");
    expect(standardsSkill).toContain(
      "harness-graph/workflows/node-typescript-standards/STANDARDS.md",
    );
  });
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");

type PackedFile = { path: string };
type PackResult = { filename: string; files: PackedFile[] };

let packRoot: string;
let tarballPath: string;
let packedFiles: string[];

beforeAll(async () => {
  packRoot = await mkdtemp(join(tmpdir(), "harness-graph-pack-"));
  await execFileAsync("npm", ["run", "build", "--silent"], { cwd: rootDir });
  const env = { ...process.env, npm_config_dry_run: "false" };
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", packRoot],
    { cwd: rootDir, env, maxBuffer: 10 * 1024 * 1024 },
  );
  const results = JSON.parse(stdout) as PackResult[];
  const result = results[0];
  if (result === undefined) throw new Error("npm pack 没有返回包信息。");
  tarballPath = join(packRoot, result.filename);
  packedFiles = result.files.map((file) => file.path).sort();
}, 120_000);

afterAll(async () => {
  await rm(packRoot, { recursive: true, force: true });
});

describe("npm package release", () => {
  test("使用公开 scoped package 元数据", async () => {
    const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as {
      name?: string;
      private?: boolean;
      bin?: Record<string, string>;
      repository?: { url?: string };
      publishConfig?: Record<string, unknown>;
    };

    expect(packageJson).toMatchObject({
      name: "@jichaowang/harness-graph",
      private: false,
      bin: { "harness-graph": "dist/cli.js" },
      repository: { url: "git+https://github.com/evander-wang/harness-graph.git" },
      publishConfig: {
        registry: "https://registry.npmjs.org/",
        access: "public",
      },
    });
  });

  test("tarball 只包含发布所需资产", () => {
    expect(packedFiles).toEqual(expect.arrayContaining([
      "package.json",
      "dist/cli.js",
      "harness/generated/workflow-catalog.json",
      "harness/workflow-activation.yaml",
      "harness/skills/harness-graph/SKILL.md",
      "harness/skills/workflow-router/SKILL.md",
    ]));
    expect(packedFiles).not.toContain("package-lock.json");
    expect(packedFiles).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^(?:\.github|docs|src|tests)\//u),
    ]));
  });

  test("tarball 可以通过 npm exec 安装并通过 preflight", async () => {
    const smokeRoot = await mkdtemp(join(tmpdir(), "harness-graph-npx-"));
    const projectRoot = join(smokeRoot, "project");
    const env = {
      ...process.env,
      npm_config_dry_run: "false",
      npm_config_registry: "https://registry.npmjs.org/",
    };
    await mkdir(projectRoot);

    await execFileAsync(
      "npm",
      ["exec", "--yes", `--package=${tarballPath}`, "--", "harness-graph", "install", projectRoot],
      { cwd: smokeRoot, env, maxBuffer: 10 * 1024 * 1024 },
    );
    const routerPath = join(projectRoot, "harness-graph/skills/workflow-router/SKILL.md");
    await writeFile(routerPath, "用户修改的 Router\n", "utf8");
    const preview = await execFileAsync(
      "npm",
      [
        "exec",
        "--yes",
        `--package=${tarballPath}`,
        "--",
        "harness-graph",
        "install",
        "--diff",
        projectRoot,
      ],
      { cwd: smokeRoot, env, maxBuffer: 10 * 1024 * 1024 },
    );
    expect(preview.stdout).toContain("--- a/harness-graph/skills/workflow-router/SKILL.md");
    await execFileAsync(
      "npm",
      [
        "exec",
        "--yes",
        `--package=${tarballPath}`,
        "--",
        "harness-graph",
        "install",
        "--yes",
        projectRoot,
      ],
      { cwd: smokeRoot, env, maxBuffer: 10 * 1024 * 1024 },
    );
    expect(await readFile(routerPath, "utf8")).not.toBe("用户修改的 Router\n");
    const { stdout } = await execFileAsync(
      join(projectRoot, "harness-graph/bin/harness-graph"),
      ["preflight"],
      { cwd: projectRoot, env, maxBuffer: 10 * 1024 * 1024 },
    );

    expect(JSON.parse(stdout)).toMatchObject({
      status: "ready",
      harnessRoot: "harness-graph",
    });
  }, 120_000);
});

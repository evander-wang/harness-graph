import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { stageRuntime } from "../src/installation/runtime-installation.js";
import { projectRuntimePackage } from "../src/installation/runtime-package.js";

const publicPackage = {
  name: "@jichaowang/harness-graph",
  version: "0.1.0",
  private: false,
  description: "Harness Graph",
  type: "module",
  packageManager: "npm@11.3.0",
  bin: { "harness-graph": "dist/cli.js" },
  engines: { node: ">=22.0.0", npm: ">=10.0.0" },
  dependencies: {},
} as const;

describe("Runtime package", () => {
  test("公开发布包投影为私有项目 Runtime", () => {
    expect(projectRuntimePackage(publicPackage)).toEqual({
      ...publicPackage,
      private: true,
    });
  });

  test("不依赖发布包根目录的 package-lock.json", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "harness-graph-runtime-source-"));
    const temporaryRoot = await mkdtemp(join(tmpdir(), "harness-graph-runtime-stage-"));
    await mkdir(join(sourceRoot, "dist"));
    await writeFile(join(sourceRoot, "dist/cli.js"), "#!/usr/bin/env node\n", "utf8");
    await writeFile(
      join(sourceRoot, "package.json"),
      `${JSON.stringify(publicPackage, null, 2)}\n`,
      "utf8",
    );

    const inheritedDryRun = process.env.npm_config_dry_run;
    process.env.npm_config_dry_run = "true";
    let result: Awaited<ReturnType<typeof stageRuntime>>;
    try {
      result = await stageRuntime(sourceRoot, temporaryRoot);
    } finally {
      if (inheritedDryRun === undefined) delete process.env.npm_config_dry_run;
      else process.env.npm_config_dry_run = inheritedDryRun;
    }

    await expect(access(join(result.root, "package-lock.json"))).resolves.toBeUndefined();
    const runtimePackage = JSON.parse(
      await readFile(join(result.root, "package.json"), "utf8"),
    ) as { private?: boolean };
    expect(runtimePackage.private).toBe(true);
  });
});

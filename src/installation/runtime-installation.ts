import { execFile } from "node:child_process";
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HARNESS_CLI_NAME } from "./layout.js";
import { generateRuntimeLock, writeRuntimePackage } from "./runtime-package.js";
import { hashRuntimeArtifacts } from "./runtime.js";

export const RUNTIME_ENTRIES = [
  ["dist", "runtime/dist"],
  ["package.json", "runtime/package.json"],
  ["package-lock.json", "runtime/package-lock.json"],
] as const;

export type StagedRuntime = {
  root: string;
  version: string;
  hash: string;
};

async function copyRuntimePayload(sourceRoot: string, runtimeRoot: string): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true });
  for (const [source] of RUNTIME_ENTRIES) {
    await cp(join(sourceRoot, source), join(runtimeRoot, source), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

export async function writeLauncher(harnessRoot: string): Promise<void> {
  const binRoot = join(harnessRoot, "bin");
  await mkdir(binRoot, { recursive: true });
  const launcherPath = join(binRoot, HARNESS_CLI_NAME);
  await writeFile(
    launcherPath,
    [
      "#!/usr/bin/env sh\n",
      "set -eu\n\n",
      'HARNESS_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\n',
      'exec node "$HARNESS_ROOT/runtime/dist/cli.js" "$@"\n',
    ].join(""),
    "utf8",
  );
  await chmod(launcherPath, 0o755);
}

export async function installRuntimeDependencies(runtimeRoot: string): Promise<void> {
  await new Promise<void>((resolveInstall, reject) => {
    execFile(
      "npm",
      ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: runtimeRoot, encoding: "utf8" },
      (error) => {
        if (error === null) resolveInstall();
        else reject(new Error("项目本地 Runtime 依赖安装失败。", { cause: error }));
      },
    );
  });
}

export async function stageRuntime(
  sourceRoot: string,
  temporaryRoot: string,
): Promise<StagedRuntime> {
  const runtimeRoot = join(temporaryRoot, "runtime");
  await copyRuntimePayload(sourceRoot, runtimeRoot);
  const runtimePackage = await writeRuntimePackage(sourceRoot, join(runtimeRoot, "package.json"));
  await generateRuntimeLock(runtimeRoot);
  return {
    root: runtimeRoot,
    version: runtimePackage.version,
    hash: await hashRuntimeArtifacts(runtimeRoot),
  };
}

export function assertSupportedNodeVersion(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 22) throw new Error("Harness Graph 需要 Node.js 22 或更高版本。");
}

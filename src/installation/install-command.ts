import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import { installHarnessProject, previewHarnessAssetChanges } from "./installer.js";

export type InstallCommandIo = {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  confirm?: (question: string) => Promise<boolean>;
};

type InstallArguments = {
  workspace?: string;
  diffOnly: boolean;
  confirmed: boolean;
};

function parseInstallArguments(args: string[]): InstallArguments {
  const diffOnly = args.includes("--diff");
  const confirmed = args.includes("--yes");
  const knownOptions = ["--diff", "--yes"];
  const unknownOptions = args.filter(
    (argument) => argument.startsWith("--") && !knownOptions.includes(argument),
  );
  const workspaces = args.filter((argument) => !argument.startsWith("--"));
  if (unknownOptions.length > 0) throw new Error(`未知 install 选项：${unknownOptions.join(", ")}`);
  if (workspaces.length > 1) throw new Error("install 只接受一个目标目录。");
  if (diffOnly && confirmed) throw new Error("--diff 和 --yes 不能同时使用。");
  return {
    ...(workspaces[0] === undefined ? {} : { workspace: workspaces[0] }),
    diffOnly,
    confirmed,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function requestAssetOverwrite(
  options: InstallArguments,
  entries: readonly string[],
  io: InstallCommandIo,
): Promise<boolean> {
  if (options.confirmed || entries.length === 0) return entries.length > 0;
  if (io.confirm === undefined) {
    io.stderr("非交互环境未覆盖发布资产；需要覆盖时请在 install 后添加 --yes。");
    return false;
  }
  const accepted = await io.confirm(`确认覆盖以上 ${String(entries.length)} 个发布资产？`);
  if (!accepted) io.stdout("已取消，未覆盖发布资产。");
  return accepted;
}

export async function runInstallCommand(
  args: string[],
  io: InstallCommandIo,
  sourceRoot: string,
): Promise<number> {
  try {
    const options = parseInstallArguments(args);
    const projectRoot = resolve(io.cwd, options.workspace ?? ".");
    const hasCurrentInstallation = await exists(join(projectRoot, "harness-graph/installation.json"));
    if (options.diffOnly && !hasCurrentInstallation) {
      io.stderr("项目尚未安装 Harness Graph；请先执行 install。");
      return 1;
    }
    let overwriteAssets = false;
    if (hasCurrentInstallation) {
      const preview = await previewHarnessAssetChanges({ sourceRoot, projectRoot });
      if (preview.entries.length === 0) io.stdout("发布资产与当前 npm 包一致，无需覆盖。");
      else io.stdout(preview.diff);
      if (options.diffOnly) return 0;
      overwriteAssets = await requestAssetOverwrite(options, preview.entries, io);
    }
    const result = await installHarnessProject({
      sourceRoot,
      projectRoot,
      overwriteMaintainedAssets: overwriteAssets,
    });
    io.stdout(JSON.stringify(result));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

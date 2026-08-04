import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { load } from "js-yaml";

import { resolveHarnessLayout } from "./paths.js";

export type CheckCommand = {
  command: string;
  args: string[];
  cwd?: "harness" | "workspace";
};

export type CheckDefinition = {
  checkId: string;
  commands: CheckCommand[];
};

export type CheckCommandExecution = CheckCommand & {
  checkId: string;
  cwd: "harness" | "workspace";
  exitCode: number;
  durationMs: number;
  outputDigest: string;
};

export type LoadCheckDefinitionOptions = {
  rootDir: string;
  checkId: string;
};

export type ExecuteDeterministicChecksOptions = {
  rootDir: string;
  workspaceRoot?: string;
  checkIds: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function parseFrontMatter(source: string): unknown {
  const lines = source.split(/\r?\n/u);
  if (lines[0] !== "---") {
    return {};
  }
  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) {
    throw new Error("Check YAML Front Matter 缺少结束标记。 ");
  }
  return load(lines.slice(1, endIndex).join("\n"));
}

function parseCommands(value: unknown, checkId: string): CheckCommand[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Check '${checkId}' 的 commands 必须是数组。`);
  }

  return value.map((item) => {
    const record = asRecord(item);
    const command = record?.command;
    const args = record?.args ?? [];
    const cwd = record?.cwd;
    if (typeof command !== "string" || command.length === 0 || !Array.isArray(args)) {
      throw new Error(`Check '${checkId}' 的 commands 必须使用 command 和 args 结构。`);
    }
    const parsedArgs = args.map((argument) => {
      if (typeof argument !== "string") {
        throw new Error(`Check '${checkId}' 的 commands 必须使用 command 和 args 结构。`);
      }
      return argument;
    });
    if (cwd !== undefined && cwd !== "harness" && cwd !== "workspace") {
      throw new Error(`Check '${checkId}' 的 cwd 只允许 harness 或 workspace。`);
    }
    return { command, args: parsedArgs, ...(cwd === undefined ? {} : { cwd }) };
  });
}

export async function loadCheckDefinition(
  options: LoadCheckDefinitionOptions,
): Promise<CheckDefinition> {
  const checkPath = join(resolveHarnessLayout(options.rootDir).checksRoot, options.checkId, "CHECK.md");
  const source = await readFile(checkPath, "utf8");
  const frontMatter = asRecord(parseFrontMatter(source));
  return {
    checkId: options.checkId,
    commands: parseCommands(frontMatter?.commands, options.checkId),
  };
}

async function executeCommand(
  harnessRoot: string,
  workspaceRoot: string,
  checkId: string,
  definition: CheckCommand,
): Promise<CheckCommandExecution> {
  const startedAt = Date.now();
  const outputHash = createHash("sha256");
  outputHash.update("stdout\0");

  const commandCwd = definition.cwd ?? "workspace";
  const exitCode = await new Promise<number>((resolveExit) => {
    const child = spawn(definition.command, definition.args, {
      cwd: commandCwd === "harness" ? harnessRoot : workspaceRoot,
      env: { ...process.env, HARNESS_WORKSPACE_ROOT: workspaceRoot },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      outputHash.update(chunk);
    });
    child.stderr.once("data", () => {
      outputHash.update("\0stderr\0");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputHash.update(chunk);
    });
    child.once("error", (error) => {
      outputHash.update(`\0error\0${error.message}`);
      resolveExit(127);
    });
    child.once("close", (code) => {
      resolveExit(code ?? 1);
    });
  });

  return {
    checkId,
    ...definition,
    cwd: commandCwd,
    exitCode,
    durationMs: Date.now() - startedAt,
    outputDigest: `sha256:${outputHash.digest("hex")}`,
  };
}

function commandForLayout(installed: boolean, definition: CheckCommand): CheckCommand {
  if (
    !installed &&
    definition.command === "node" &&
    definition.args[0] === "runtime/dist/cli.js"
  ) {
    return { ...definition, args: ["dist/cli.js", ...definition.args.slice(1)] };
  }
  return definition;
}

export async function executeDeterministicChecks(
  options: ExecuteDeterministicChecksOptions,
): Promise<CheckCommandExecution[]> {
  const rootDir = resolve(options.rootDir);
  const layout = resolveHarnessLayout(rootDir);
  const workspaceRoot = resolve(options.workspaceRoot ?? layout.workspaceRoot);
  const results: CheckCommandExecution[] = [];
  for (const checkId of options.checkIds) {
    const definition = await loadCheckDefinition({ rootDir, checkId });
    for (const command of definition.commands) {
      results.push(
        await executeCommand(
          layout.harnessRoot,
          workspaceRoot,
          checkId,
          commandForLayout(layout.installed, command),
        ),
      );
    }
  }
  return results;
}

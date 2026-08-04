import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RuntimePackageJson = {
  name: string;
  version: string;
  private: true;
  description: string;
  type: "module";
  packageManager: string;
  bin: {
    "harness-next": string;
  };
  engines: {
    node: string;
    npm: string;
  };
  dependencies: Record<string, string>;
};

function asRecord(value: unknown, displayPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${displayPath} 必须是 JSON 对象。`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  displayPath: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${displayPath} 缺少有效的 ${key}。`);
  }
  return value;
}

function requiredStringRecord(
  source: Record<string, unknown>,
  key: string,
  displayPath: string,
): Record<string, string> {
  const record = asRecord(source[key], `${displayPath}.${key}`);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(record)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${displayPath}.${key}.${name} 必须是非空字符串。`);
    }
    result[name] = value;
  }
  return result;
}

export function projectRuntimePackage(
  source: unknown,
  displayPath = "package.json",
): RuntimePackageJson {
  const packageJson = asRecord(source, displayPath);
  const privateValue = packageJson.private;
  if (privateValue !== true) {
    throw new Error(`${displayPath}.private 必须为 true。`);
  }
  const type = requiredString(packageJson, "type", displayPath);
  if (type !== "module") {
    throw new Error(`${displayPath}.type 必须为 module。`);
  }
  const bin = requiredStringRecord(packageJson, "bin", displayPath);
  if (bin["harness-next"] === undefined) {
    throw new Error(`${displayPath}.bin.harness-next 缺失。`);
  }
  const engines = requiredStringRecord(packageJson, "engines", displayPath);
  if (engines.node === undefined || engines.npm === undefined) {
    throw new Error(`${displayPath}.engines 必须声明 node 和 npm。`);
  }
  return {
    name: requiredString(packageJson, "name", displayPath),
    version: requiredString(packageJson, "version", displayPath),
    private: true,
    description: requiredString(packageJson, "description", displayPath),
    type: "module",
    packageManager: requiredString(packageJson, "packageManager", displayPath),
    bin: { "harness-next": bin["harness-next"] },
    engines: { node: engines.node, npm: engines.npm },
    dependencies: requiredStringRecord(packageJson, "dependencies", displayPath),
  };
}

export async function writeRuntimePackage(
  sourceRoot: string,
  runtimePackagePath: string,
): Promise<RuntimePackageJson> {
  const sourcePath = join(sourceRoot, "package.json");
  const runtimePackage = projectRuntimePackage(
    JSON.parse(await readFile(sourcePath, "utf8")) as unknown,
    sourcePath,
  );
  await writeFile(runtimePackagePath, `${JSON.stringify(runtimePackage, null, 2)}\n`, "utf8");
  return runtimePackage;
}

export async function generateRuntimeLock(runtimeRoot: string): Promise<void> {
  try {
    await execFileAsync(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: runtimeRoot, encoding: "utf8" },
    );
  } catch (error: unknown) {
    throw new Error("项目本地 Runtime 生产依赖锁文件生成失败。", { cause: error });
  }
}

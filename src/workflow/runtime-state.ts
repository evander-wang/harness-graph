import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function assertRunId(runId: string): void {
  if (!/^[a-zA-Z0-9-]+$/u.test(runId)) {
    throw new Error("Workflow Run ID 非法。");
  }
}

function statePath(stateRoot: string, runId: string): string {
  assertRunId(runId);
  return join(stateRoot, "runs", runId, "state.json");
}

async function tryCreateLock(lockPath: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    await handle.close();
    return true;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "EEXIST") return false;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !isNodeError(error) || error.code !== "ESRCH";
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const lockEntry = await stat(lockPath);
    const ownerPath = lockEntry.isDirectory() ? join(lockPath, "owner.json") : lockPath;
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as { pid?: unknown };
    if (typeof owner.pid === "number" && Number.isInteger(owner.pid) && processIsAlive(owner.pid)) {
      return;
    }
    await rm(lockPath, { recursive: true, force: true });
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    if (error instanceof SyntaxError) {
      await rm(lockPath, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

async function acquireRuntimeLock(stateRoot: string): Promise<string> {
  await mkdir(stateRoot, { recursive: true });
  const lockPath = join(stateRoot, "runtime.lock");
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await tryCreateLock(lockPath)) return lockPath;
    await removeStaleLock(lockPath);
    await delay(10);
  }
  throw new Error("Workflow Runtime 正忙，请稍后重试。");
}

export async function withRuntimeLock<T>(
  stateRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = await acquireRuntimeLock(stateRoot);
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function writeRunState(
  stateRoot: string,
  runId: string,
  state: unknown,
): Promise<void> {
  const path = statePath(stateRoot, runId);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function readRunState(stateRoot: string, runId: string): Promise<unknown> {
  return JSON.parse(await readFile(statePath(stateRoot, runId), "utf8")) as unknown;
}

export async function readAllRunStates(stateRoot: string): Promise<unknown[]> {
  let entries;
  try {
    entries = await readdir(join(stateRoot, "runs"), { withFileTypes: true });
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return Promise.all(runIds.map((runId) => readRunState(stateRoot, runId)));
}

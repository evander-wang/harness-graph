import { access } from "node:fs/promises";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const AGENT_START_MARKER = "<!-- harness-graph:start version=1 -->";
export const AGENT_END_MARKER = "<!-- harness-graph:end -->";
export const GITIGNORE_START_MARKER = "# harness-graph:start";
export const GITIGNORE_END_MARKER = "# harness-graph:end";

const LEGACY_AGENT_START_MARKER = "<!-- harness-next:start version=1 -->";
const LEGACY_AGENT_END_MARKER = "<!-- harness-next:end -->";
const LEGACY_GITIGNORE_START_MARKER = "# harness-next:start";
const LEGACY_GITIGNORE_END_MARKER = "# harness-next:end";

const AGENT_BLOCK = `${AGENT_START_MARKER}
## Harness Graph

处理本项目的任何开发任务前，必须先执行：

\`./harness-graph/bin/harness-graph route\`

必须遵循 Runtime 返回的当前 Step，不得自行解析 Workflow、跳过 Check 或直接进入后续 Step。

\`harness-graph/workflows/\`、\`harness-graph/models/\`、\`harness-graph/checks/\` 和
\`harness-graph/skills/\` 是本项目维护的 Harness 事实源。

本文件其余项目开发规范继续有效。入口不可用、preflight 失败或 Workflow
进入 blocked 状态时，必须停止并报告，不得绕过 Harness Graph。
${AGENT_END_MARKER}
`;

const GITIGNORE_BLOCK = `${GITIGNORE_START_MARKER}
harness-graph/runtime/node_modules/
harness-graph/.state/
${GITIGNORE_END_MARKER}
`;

export type ManagedFileUpdate = {
  path: string;
  current: string;
  next: string;
  existed: boolean;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function countOccurrences(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

export function assertManagedBlock(
  source: string,
  startMarker: string,
  endMarker: string,
  path: string,
): void {
  const starts = countOccurrences(source, startMarker);
  const ends = countOccurrences(source, endMarker);
  if (starts !== 1 || ends !== 1 || source.indexOf(startMarker) > source.indexOf(endMarker)) {
    throw new Error(`${path} 的 Harness Graph 托管块必须存在且唯一。`);
  }
}

function renderManagedFile(
  source: string,
  startMarker: string,
  endMarker: string,
  block: string,
  path: string,
): string {
  const starts = countOccurrences(source, startMarker);
  const ends = countOccurrences(source, endMarker);
  if (starts > 1 || ends > 1 || starts !== ends) {
    throw new Error(`${path} 中的 Harness Graph 托管块损坏或重复。`);
  }
  if (starts === 0) return source.length === 0 ? block : `${block}\n${source}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < start) {
    throw new Error(`${path} 中的 Harness Graph 托管块损坏或重复。`);
  }
  const afterMarker = end + endMarker.length;
  const suffixStart = source.startsWith("\r\n", afterMarker)
    ? afterMarker + 2
    : source.startsWith("\n", afterMarker)
      ? afterMarker + 1
      : afterMarker;
  return `${source.slice(0, start)}${block}${source.slice(suffixStart)}`;
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function assertRegularFileOrMissing(path: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error(`${path} 不是普通文件。`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export async function prepareManagedProjectFiles(
  projectRoot: string,
  migrateLegacyBrand = false,
): Promise<ManagedFileUpdate[]> {
  const definitions = [
    [
      "AGENTS.md",
      AGENT_START_MARKER,
      AGENT_END_MARKER,
      LEGACY_AGENT_START_MARKER,
      LEGACY_AGENT_END_MARKER,
      AGENT_BLOCK,
    ],
    [
      "CLAUDE.md",
      AGENT_START_MARKER,
      AGENT_END_MARKER,
      LEGACY_AGENT_START_MARKER,
      LEGACY_AGENT_END_MARKER,
      AGENT_BLOCK,
    ],
    [
      ".gitignore",
      GITIGNORE_START_MARKER,
      GITIGNORE_END_MARKER,
      LEGACY_GITIGNORE_START_MARKER,
      LEGACY_GITIGNORE_END_MARKER,
      GITIGNORE_BLOCK,
    ],
  ] as const;
  const updates: ManagedFileUpdate[] = [];
  for (const [name, startMarker, endMarker, legacyStart, legacyEnd, block] of definitions) {
    const path = join(projectRoot, name);
    await assertRegularFileOrMissing(path);
    const existed = await exists(path);
    const current = await readOptionalFile(path);
    if (
      migrateLegacyBrand &&
      (countOccurrences(current, startMarker) > 0 || countOccurrences(current, endMarker) > 0)
    ) {
      throw new Error(`${name} 同时包含新旧 Harness Graph 托管块。`);
    }
    const next = renderManagedFile(
      current,
      migrateLegacyBrand ? legacyStart : startMarker,
      migrateLegacyBrand ? legacyEnd : endMarker,
      block,
      name,
    );
    updates.push({ path, current, next, existed });
  }
  return updates;
}

export async function writeManagedProjectFiles(
  updates: readonly ManagedFileUpdate[],
): Promise<boolean> {
  let changed = false;
  try {
    for (const update of updates) {
      if (update.next !== update.current) {
        await writeFile(update.path, update.next, "utf8");
        changed = true;
      }
    }
  } catch (error: unknown) {
    await restoreManagedProjectFiles(updates);
    throw error;
  }
  return changed;
}

export async function restoreManagedProjectFiles(
  updates: readonly ManagedFileUpdate[],
): Promise<void> {
  for (const update of updates) {
    if (update.existed) await writeFile(update.path, update.current, "utf8");
    else await rm(update.path, { force: true });
  }
}

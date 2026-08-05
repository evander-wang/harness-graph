import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { expect } from "vitest";

export async function expectGolden(path: string, value: unknown): Promise<void> {
  const actual = `${JSON.stringify(value, null, 2)}\n`;
  const displayPath = relative(resolve(import.meta.dirname, "../.."), path);
  const updateCommand = "UPDATE_GOLDEN=1 npm test";
  if (process.env.UPDATE_GOLDEN === "1") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, actual, "utf8");
    return;
  }
  let expected: string;
  try {
    expected = await readFile(path, "utf8");
  } catch (error: unknown) {
    throw new Error(
      `Golden 缺失：${displayPath}。仅在确认输出正确后运行：${updateCommand}`,
      { cause: error },
    );
  }
  expect(
    actual,
    `Golden 发生变化：${displayPath}。确认属于预期变更后运行：${updateCommand}`,
  ).toBe(expected);
}

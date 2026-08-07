import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { validatePublishedAssetNames } from "../src/workflow/asset-naming.js";

const rootDir = resolve(import.meta.dirname, "..");
describe("published asset naming", () => {
  test("所有现有全局资产使用明确作用域且内部名称与路径一致", async () => {
    expect(await validatePublishedAssetNames(rootDir)).toEqual([]);
  });
});

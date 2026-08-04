import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const HASHED_ENTRIES = ["dist", "package.json", "package-lock.json"] as const;

async function collectFiles(root: string, relativePath: string): Promise<string[]> {
  const absolutePath = join(root, relativePath);
  const entry = await stat(absolutePath);
  if (entry.isFile()) return [relativePath];
  if (!entry.isDirectory()) {
    throw new Error(`Runtime 文件类型不受支持：${relativePath}`);
  }
  const children = await readdir(absolutePath, { withFileTypes: true });
  const files: string[] = [];
  for (const child of children) {
    files.push(...await collectFiles(root, join(relativePath, child.name)));
  }
  return files;
}

export async function hashRuntimeArtifacts(runtimeRoot: string): Promise<string> {
  const files = (await Promise.all(HASHED_ENTRIES.map((entry) => collectFiles(runtimeRoot, entry))))
    .flat()
    .sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath.split("\\").join("/"));
    hash.update("\0");
    hash.update(await readFile(join(runtimeRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

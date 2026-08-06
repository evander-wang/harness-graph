import { cp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(rootDir, "dist/web");

await rm(outputDir, { recursive: true, force: true });
await cp(join(rootDir, "web"), outputDir, { recursive: true });

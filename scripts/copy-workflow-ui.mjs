import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(rootDir, "dist/web");

await mkdir(outputDir, { recursive: true });
await cp(join(rootDir, "web"), outputDir, { recursive: true, force: true });

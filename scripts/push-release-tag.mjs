import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const branch = git(["branch", "--show-current"]);
if (branch !== "main") {
  throw new Error(`发布必须从 main 分支执行，当前分支是 ${branch || "detached HEAD"}。`);
}

if (git(["status", "--porcelain"]).length > 0) {
  throw new Error("工作区存在未提交改动，请先提交后再发布。`npm version` 会创建版本提交和 Tag。 ");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${packageJson.version}`;
const tagCommit = git(["rev-list", "-n", "1", tag]);
const headCommit = git(["rev-parse", "HEAD"]);
if (tagCommit !== headCommit) {
  throw new Error(`${tag} 没有指向当前 HEAD，请确认版本 Tag 来自 npm version。`);
}

execFileSync("git", ["push", "origin", "main"], { stdio: "inherit" });
execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
console.log(`已推送 main 和 ${tag}，GitHub Actions 将自动发布 npm。`);

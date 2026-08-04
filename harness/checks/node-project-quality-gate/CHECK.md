---
commands:
  - command: node
    args: [runtime/dist/cli.js, project-check]
    cwd: harness
  - command: git
    args: [diff, --check]
    cwd: workspace
---

# node-project-quality-gate

`project-check` 根据 `package.json#packageManager` 和根 Lockfile 自动识别 npm、Yarn 或 pnpm，先检查工程基线，再依次执行 Typecheck、Lint、Test 和 Build。

任一静态配置或命令检查失败时返回 `needs_changes`。包管理器冲突、缺少本机命令或权限等不能安全自动处理的情况，由 Agent 根据证据返回 `blocked`。

状态记录只保存命令、参数、退出码、耗时和输出 Digest，不保存完整输出。

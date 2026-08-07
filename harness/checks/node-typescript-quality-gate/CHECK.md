---
commands:
  - command: node
    args: [runtime/dist/cli.js, project-check]
    cwd: harness
  - command: node
    args: [runtime/dist/cli.js, node-policy-check, --changed]
    cwd: harness
  - command: git
    args: [diff, --check]
    cwd: workspace
---

# node-typescript-quality-gate

`project-check` 自动识别 npm、Yarn 或 pnpm，并依次执行目标项目的 Typecheck、Lint、Test 和 Build。`node-policy-check --changed` 使用 `workflows/node-typescript-standards/STANDARDS.md` 只检查本次变更的生产 TypeScript 文件，包括行宽、函数行数、文件行数和圈复杂度。全部退出码为 `0` 时保留 Agent 的检查状态；任一命令失败时，Runtime 将当前结果视为 `needs_changes` 并返回实现 Step。

状态记录只保存命令、参数、退出码、耗时和输出 Digest，不保存完整输出。

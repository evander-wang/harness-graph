---
name: verify-node-project
description: 准备执行包管理器自适应的 Node.js TypeScript 项目质量门禁。
---

# 验证 Node.js TypeScript 项目

确认 Runtime 返回的目标项目目录与 Input 的 `projectRoot` 一致，并确认配置步骤已经在目标目录产生 `package.json`、唯一根 Lockfile、TypeScript、ESLint、README、`.gitignore`、CI 和标准 scripts。

本 Step 不自行声称命令通过。绑定的 `node-project-quality-gate` 使用 `project-check` 自动识别 npm、Yarn 或 pnpm，并依次执行 Typecheck、Lint、Test、Build 和 `git diff --check`。

包管理器冲突、缺少本机命令、权限或网络导致不能完成必要安装时返回 `blocked`；项目配置或命令失败返回 `needs_changes`。

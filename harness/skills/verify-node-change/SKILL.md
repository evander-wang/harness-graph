---
name: verify-node-change
description: 准备执行 Node.js TypeScript 项目的确定性质量门禁。
---

# 验证 Node.js TypeScript 变更

确认目标项目存在质量门禁要求的 npm scripts，并说明无法执行的环境条件。

本 Step 不自行声称命令通过。Lint、Typecheck、Test、Build 和 Git Diff 检查由绑定的 Check 交给 Runtime 执行并记录退出码和 Digest。

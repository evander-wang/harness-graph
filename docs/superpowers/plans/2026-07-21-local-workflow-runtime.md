# Local Workflow Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan task-by-task in the current worktree. Do not commit or push unless the user explicitly asks.

**Goal:** 为本地 Agent 增加方案 B：统一 Workflow Router、Catalog 同步、可恢复的 `start / continue / cancel` Runtime，以及 Node.js TypeScript 开发 Workflow。

**Architecture:** `workflow.yaml` 仍是唯一流程事实源。Catalog 只保存可重新生成的路由索引；Runtime 通过小 Interface 隐藏状态持久化、Workflow Hash、Revision、Cycle 次数、确定性 Check 和 Transition 计算。Router Skill 只负责选择 Workflow 并反复调用 Runtime，不自行解析流程或决定跳转。

**Tech Stack:** Node.js 22、严格 TypeScript、Open Workflow SDK 1.0.3、AJV、Vitest、js-yaml。

---

### Task 1: Workflow Catalog

**Files:**
- Create: `src/workflow/catalog.ts`
- Create: `tests/workflow-catalog.test.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] 编写失败测试：扫描 `harness/workflows/**/workflow.yaml`，读取 `document.metadata.harness.routing`，生成稳定排序的 Catalog。
- [ ] 编写失败测试：Workflow 名称或 Alias 重复时拒绝同步。
- [ ] 编写失败测试：`--check` 在 Catalog 缺失或过期时失败，且不写文件。
- [ ] 实现 `buildWorkflowCatalog()`、`syncWorkflowCatalog()` 和 `checkWorkflowCatalog()`。
- [ ] 增加 `workflow:sync` CLI 和 npm script。

### Task 2: Check Definition and Deterministic Commands

**Files:**
- Create: `src/workflow/checks.ts`
- Create: `tests/checks.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] 编写失败测试：从 `CHECK.md` YAML Front Matter 读取结构化 `commands`。
- [ ] 编写失败测试：拒绝缺少 `command`、非字符串参数和 Shell 字符串。
- [ ] 编写失败测试：命令执行记录只保存命令、参数、退出码、耗时和输出 Digest。
- [ ] 将 `js-yaml@5.2.1` 声明为直接依赖。
- [ ] 使用 `spawn` 且 `shell: false` 执行本地命令。

### Task 3: Local Workflow Runtime

**Files:**
- Create: `src/workflow/runtime.ts`
- Create: `tests/workflow-runtime.test.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] 编写失败测试：`start` 创建 Run、校验输入、固定 Workflow Hash，并返回首个 Skill 指令。
- [ ] 编写失败测试：相同 `executionKey` 幂等恢复，不同活动 Run 在同一 Worktree 被拒绝。
- [ ] 编写失败测试：`continue` 拒绝错误 Revision、错误 Step 和缺失 Evidence。
- [ ] 编写失败测试：`passed`、`needs_changes`、`blocked` 和 `switch` Cycle 正确流转。
- [ ] 编写失败测试：超过最大 Step 尝试次数后阻塞。
- [ ] 编写失败测试：Workflow 文件改变后拒绝继续。
- [ ] 编写失败测试：确定性 Check 失败时覆盖为 `needs_changes` 并保存命令证据。
- [ ] 编写失败测试：到达 `end` 时校验 Workflow Output Schema。
- [ ] 编写失败测试：`cancel` 将 Run 终止，终止后的 Run 不能继续。
- [ ] 使用临时文件加重命名原子写入 `.harness/runs/<run-id>/state.json`。
- [ ] 增加 `workflow:start`、`workflow:continue`、`workflow:cancel` CLI 和 npm scripts。

### Task 4: Router and Node.js Workflow

**Files:**
- Create: `skills/workflow-router/SKILL.md`
- Create: `skills/node-typescript-analyze-change/SKILL.md`
- Create: `skills/node-typescript-implement-change/SKILL.md`
- Create: `skills/node-typescript-verify-change/SKILL.md`
- Create: `skills/node-typescript-review-change/SKILL.md`
- Create: `skills/node-typescript-deliver-change/SKILL.md`
- Create: `harness/checks/common-change-plan-ready/CHECK.md`
- Create: `harness/checks/node-typescript-quality-gate/CHECK.md`
- Create: `harness/checks/common-change-review-result/CHECK.md`
- Create: `harness/models/node-typescript-change-request.schema.json`
- Create: `harness/models/node-typescript-change-result.schema.json`
- Create: `harness/workflows/node-typescript-development/workflow.yaml`

- [ ] Router 只读取 Catalog；明确匹配一个 Workflow 后调用 Runtime，多候选或无候选时停止。
- [ ] Workflow 声明 Alias、适用场景、排除场景和最大尝试次数。
- [ ] 确定性质量门禁执行 Lint、Typecheck、Test、Build 和 `git diff --check`。
- [ ] 分析、质量和 Review 未通过时分别回到正确 Step。
- [ ] Delivery 输出满足 Node.js 变更结果 Schema。

### Task 5: Documentation and Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `keywords.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/design.md`
- Modify: `harness/workflows/README.md`
- Modify: `harness/checks/README.md`
- Modify: `skills/README.md`
- Modify: `.gitignore`

- [ ] 明确 Router 是唯一入口，Runtime 是内部实现，不增加新的流程核心关键词。
- [ ] 说明 `start / continue / cancel` 由 Router 自动调用，宿主重启自动恢复不在第一版保证范围内。
- [ ] 将 `.harness/` 加入 `.gitignore`，运行记录禁止保存 Secret 和完整 Prompt。
- [ ] 运行 `npm run workflow:sync` 并生成 Node.js Workflow SVG。
- [ ] 运行 `npm run check:all`、`npm run doctor`、两个 Workflow 的 validate 和 image 命令。
- [ ] 检查 Git Diff，确认未覆盖既有用户修改且没有无关文件。

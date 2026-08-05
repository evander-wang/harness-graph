# Node.js TypeScript Project Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan task-by-task in the current worktree. Do not commit or push unless the user explicitly asks.

**Goal:** 增加一个能够初始化新项目、规范化已有 npm/Yarn/pnpm 项目并自动验证 Typecheck、Lint、Test、Build 的 Node.js TypeScript 项目配置 Workflow。

**Architecture:** `node-project-configuration` 继续使用标准 `workflow.yaml`、本地 Skill 和 Check。包管理器识别与命令适配收口在 `src/node-project/` 深 Module 中，CLI 只暴露 `project-check`；Workflow 和现有 Node.js 开发质量门禁共同调用它，不复制包管理器规则。

**Execution Roots:** Harness Root 保存流程定义和 Run 状态；Input 的 `projectRoot` 固化目标 Workspace Root。Check 使用 `cwd: harness | workspace` 选择执行目录。

**Tech Stack:** Node.js 22+ Runtime、严格 TypeScript、Vitest、Open Workflow Specification 1.0.3、npm/Yarn/pnpm 本地命令。

---

### Task 1: 包管理器识别 Module

**Files:**
- Create: `src/node-project/package-manager.ts`
- Create: `tests/package-manager.test.ts`

- [ ] 写失败测试：空目录返回 `new`、默认 npm，并记录默认证据。
- [ ] 写失败测试：分别通过 `packageManager` 和根 Lockfile 识别 npm、Yarn、pnpm。
- [ ] 写失败测试：忽略 `node_modules/.package-lock.json`。
- [ ] 写失败测试：已有 `package.json` 但没有声明和 Lockfile 时返回 `unknown`。
- [ ] 写失败测试：多 Lockfile、声明与 Lockfile 不一致、非法 `packageManager` 时返回 `conflict`。
- [ ] 运行 `npm test -- tests/package-manager.test.ts`，确认失败原因为 Module 尚不存在。
- [ ] 实现 `detectPackageManager(rootDir)`，返回判定状态、管理器、版本、证据和冲突原因。
- [ ] 再次运行测试并确认全部通过。

### Task 2: Project Check Module

**Files:**
- Create: `src/node-project/project-check.ts`
- Create: `tests/project-check.test.ts`

- [ ] 写失败测试：缺少 `package.json`、Lockfile、`tsconfig.json`、ESLint、README、`.gitignore`、CI 或标准 scripts 时返回稳定问题代码。
- [ ] 写失败测试：`.nvmrc`、`engines.node` 和 Docker 可识别 Node.js Major 冲突时失败。
- [ ] 写失败测试：npm 使用 `npm run <script>`，Yarn 使用 `yarn <script>`，pnpm 使用 `pnpm run <script>`。
- [ ] 写失败测试：按 `typecheck`、`lint`、`test`、`build` 顺序执行，并在任一命令失败后停止。
- [ ] 运行 `npm test -- tests/project-check.test.ts`，确认失败原因为 Module 尚不存在。
- [ ] 实现 `checkNodeProject()`，允许测试注入 Command Runner，生产实现使用 `spawn` 且 `shell: false`。
- [ ] 输出只包含问题、命令、参数、退出码和状态，不返回完整 stdout 或 stderr。
- [ ] 再次运行测试并确认全部通过。

### Task 3: CLI 与共享质量门禁

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`
- Modify: `package.json`
- Modify: `harness/checks/node-quality-gate/CHECK.md`
- Create: `harness/checks/node-project-quality-gate/CHECK.md`

- [ ] 写失败测试：`project-check` 对通过项目输出 JSON 并返回 0。
- [ ] 写失败测试：配置问题或脚本失败时输出结构化问题并返回 1。
- [ ] 在 CLI 用法中增加 `project-check [project-root]`，调用目标目录的 `checkNodeProject()`。
- [ ] 增加 `npm run project:check`，只作为 Harness Graph 开发与直接调试入口。
- [ ] 将两个质量门禁统一为 `node dist/cli.js project-check` 与 `git diff --check`。
- [ ] 运行 CLI、Check 和 Project Check 相关测试。

### Task 3A: 目标项目执行目录

**Files:**
- Modify: `src/workflow/checks.ts`
- Modify: `src/workflow/runtime.ts`
- Modify: `src/cli.ts`
- Modify: `tests/checks.test.ts`
- Modify: `tests/workflow-runtime.test.ts`
- Modify: `tests/cli.test.ts`

- [ ] 写失败测试：Check 的 `cwd: workspace` 在目标项目执行。
- [ ] 写失败测试：Runtime 固化 Workspace Root 并在恢复时复用。
- [ ] 写失败测试：`project-check <project-root>` 可以从 Harness 根目录检查另一个项目。
- [ ] 实现 Harness Root 与 Workspace Root 分离，默认仍为当前目录。
- [ ] 将目标目录通过 `HARNESS_WORKSPACE_ROOT` 提供给 Harness 命令。

### Task 4: Workflow、Schema、Skill 和主观 Check

**Files:**
- Create: `harness/workflows/node-project-configuration/workflow.yaml`
- Create: `harness/models/node-project-configuration-request.schema.json`
- Create: `harness/models/node-project-profile.schema.json`
- Create: `harness/models/node-project-configuration-result.schema.json`
- Create: `skills/analyze-node-project/SKILL.md`
- Create: `skills/configure-node-project/SKILL.md`
- Create: `skills/configure-node-project/BASELINE.md`
- Create: `skills/verify-node-project/SKILL.md`
- Create: `skills/review-node-project-configuration/SKILL.md`
- Create: `skills/deliver-node-project-configuration/SKILL.md`
- Create: `harness/checks/node-project-plan-ready/CHECK.md`
- Create: `harness/checks/node-project-review-result/CHECK.md`
- Modify: `tests/compiler.test.ts`
- Modify: `tests/workflow-catalog.test.ts`

- [ ] 写失败测试：新 Workflow 编译成功并包含分析、配置、验证、审查、交付以及三个回改分支。
- [ ] 写失败测试：Catalog 包含唯一名称、Alias、when 和 notWhen。
- [ ] 创建三个 JSON Schema；Result 通过 `$ref` 复用 Profile，不复制实体字段。
- [ ] 创建五个 Skill 和版本化新项目基线，明确默认工具版本、已有项目保守修改、包管理器冲突和 Secret 规则。
- [ ] 创建计划与 Review Check；质量 Check 使用 Task 3 的确定性入口。
- [ ] 创建 Workflow 并执行定向编译测试。

### Task 5: 当前仓库 Dogfood 与文档

**Files:**
- Create: `.nvmrc`
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/design.md`
- Modify: `harness/workflows/README.md`
- Modify: `harness/checks/README.md`
- Modify: `skills/README.md`

- [ ] 为当前 npm 项目补充与 `engines.node` 一致的 `.nvmrc`。
- [ ] 增加使用 npm clean install 和 `npm run check:all` 的 CI。
- [ ] 文档增加项目配置 Workflow 的适用范围、自动检测规则和使用示例。
- [ ] AGENTS 完成命令加入新 Workflow validate、image 和 `project:check`。
- [ ] 明确 Workflow 只操作 Input 指定的本地目标目录，不提供远程目标。

### Task 6: 生成物与验收矩阵

**Files:**
- Modify: `harness/generated/workflow-catalog.json`（命令生成）
- Create: `harness/generated/node-project-configuration.svg`（命令生成）

- [ ] 执行 `npm run workflow:sync` 更新 Catalog。
- [ ] 执行 `npm run workflow:image -- harness/workflows/node-project-configuration/workflow.yaml` 生成 SVG。
- [ ] 使用临时 npm、Yarn、pnpm fixture 运行 `project-check`，证明命令适配正确；测试中使用注入 Runner，避免依赖全局安装。
- [ ] 执行 `npm run project:check`。
- [ ] 执行 `npm run check:all` 和 `npm run doctor`。
- [ ] 对三个 Workflow 执行 `workflow:validate` 和 `workflow:image`。
- [ ] 执行 `git diff --check`，检查没有 Secret、无关生成物或用户改动被覆盖。
- [ ] 逐项对照设计文档验收矩阵，缺少直接证据的要求不得声明完成。

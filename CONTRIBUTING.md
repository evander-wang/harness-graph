# Harness Graph 贡献指南

## 修改前

```bash
npm install
npm run project:check
npm run check:all
npm run doctor
```

依次阅读 `README.md`、`keywords.md`、`docs/design.md` 和目标 Workflow。

## 新增 Workflow

1. 需要稳定业务输入输出时，在 `harness/models/` 新增 JSON Schema；没有业务数据时省略。
2. 创建 `harness/workflows/<workflow-name>/workflow.yaml`。
3. 使用 Open Workflow Specification `1.0.3` 声明 `document` 和 `do`，按需声明 `input`、`output`。
4. 在 `document.metadata.harness.routing` 声明 Alias、适用场景和排除场景。
5. 会修改项目文件的入口 Workflow 必须在 `document.metadata.harness.prerequisites` 中声明 `common-change-execution-policy`；语言 Standards 使用另一个前置 Workflow 组合，禁止复制通用执行协议。
6. 使用自定义 `call` 绑定本地 Skill。
7. 固定流转可以不绑定 Check；进入 `switch` 前必须在 `metadata.harness.checks` 中绑定 Check。通用 Check 和领域 Check 可以在同一 Step 组合，领域 Check 不重复通用规则。
8. 使用声明顺序、`then` 和 `switch` 表达流程；`when` 只允许比较标准 Check 状态。
9. 为主流程、所有分支、回改 Cycle 和错误声明添加测试。
10. 若 Workflow 需要被 Router 使用，在 `harness/workflow-activation.yaml` 中维护其入口 YAML 路径，并执行 `npm run workflow:activate` 更新 Catalog；`workflow:sync` 仅用于生成全量 Catalog。
11. 执行 `workflow:validate`、`workflow:diagram` 和 `workflow:image` 检查结果。

### 发布资产命名

Workflow、Skill、Check 和跨 Workflow 共享的 Model 使用 `<scope>-<capability>` 命名。跨语言公共能力使用 `common-`，语言能力使用语言前缀，公司能力使用公司前缀，业务领域能力使用领域前缀。Workflow 内部 Step 保持局部简短的 `kebab-case`，不复制全局前缀。当前仓库已有资产必须遵循同一规则；开发阶段不保留旧名称兼容层。产品入口 `harness-graph` 和 `workflow-router` 是保留名。

公司脚手架、公司标准或领域资产只有在存在真实规范、CLI、模板或稳定验收要求时才新增，不为未来能力创建占位 Workflow、Skill、Check 或 Model。

初始化或规范化 Node.js TypeScript 工程时参考 `node-typescript-project-configuration/workflow.yaml`。Input 的 `projectRoot` 指定本地目标目录，默认为当前目录；`project-check` 自动识别 npm、Yarn 或 pnpm。

## 修改位置

| 修改内容 | 修改位置 |
| --- | --- |
| Workflow 输入输出 | `harness/models/` |
| Step 和 Transition | 对应的 `workflow.yaml` |
| Step 执行方法 | `harness/skills/<skill-id>/SKILL.md` |
| 通用修改协议 | `harness/skills/common-load-change-execution-policy/SKILL.md`；入口 Workflow 只声明 prerequisite |
| 项目 Skill 规范入口 | `harness/skills/harness-graph/SKILL.md`；宿主 Adapter 由安装器生成 |
| Step 验收规则 | `harness/checks/<check-id>/CHECK.md` |
| Workflow 路由索引 | 维护 `harness/workflow-activation.yaml`，执行 `npm run workflow:activate`，禁止手工修改 Catalog |
| 本地运行状态和跳转 | `src/workflow/runtime.ts` |
| Workflow 执行摘要 | `src/workflow/report.ts`；执行记录由 `src/workflow/runtime.ts` 写入 |
| Check 命令执行 | `src/workflow/checks.ts` |
| 包管理器识别和 Node.js 项目门禁 | `src/node-project/` |
| 标准解析和本地校验 | `src/workflow/compiler.ts` |
| CLI | `src/cli.ts` |
| 项目本地安装、preflight 和 Root 推导 | `src/installation/` |

发布资产仍从本仓库的 `harness/` 读取；安装器把它们复制到业务项目的 `harness-graph/`，不能在安装代码中维护第二份 Workflow、Model、Check 或 Skill 清单。`workflow-activation.yaml` 中的入口路径相对 Harness Root，使用 `workflows/<name>/workflow.yaml`。

Runtime 发布包由 `src/installation/runtime-package.ts` 投影：只保留运行所需生产依赖，并在安装时生成专用生产 Lockfile；`src/installation/runtime.ts` 负责 Runtime 内容哈希。Runtime 版本或实现变化时，必须补充安装测试覆盖首次安装、重复 install、运行中 Run 阻断和失败回滚。执行 trace 和报告必须统一从 Runtime/Report 模块生成，不能在各个 Workflow 或 Step Skill 中重复实现。

Open Workflow 的标准 Schema 由 `@openworkflowspec/sdk` 提供，禁止复制后手工维护。

## 共享计划和接口策略

修改计划落盘、修改前读取、范围控制、询问或完成验证等跨语言行为时，只修改 `common-load-change-execution-policy` 及其通用 Check。语言 Standards 和领域 Skill 只补充专有事实源、工具和验收条件；新增 Rust、Go、PHP 或 Python Workflow 时通过 prerequisite 组合共享策略，不复制规则。

分析前读取目标 Workspace 中已有且相关的 `CONTEXT.md`、项目 `STANDARDS.md` 和 `docs/adr/`。计划在“接口与文档影响”中声明是否产生新的术语、长期规范或重要架构决定；Plan Check 通过后才能更新对应文档，Review 对照实际 Diff 验证一致性。不存在的知识文档不因流程运行而自动创建占位文件。

外部 Skill 只作为当前 Step 的可选方法提示。宿主发现不到时，本地 Skill 必须仍能完成任务；外部 Skill 不得改变写入范围、Step Result、Check 或 Transition，也不应引入 Provider、Adapter 或 Registry。

非平凡变更的计划保存在目标业务项目的既有计划位置；没有约定时使用 `docs/plans/YYYY-MM-DD-<slug>.md`。计划必须包含“接口与文档影响”，分析结果通过现有 evidence 的 `planPath=` 交给后续 Step。不要给 Workflow 或 Runtime 增加 Plan 顶层类型，也不要把计划正文写进 Run 状态。

新增或变更公开 Interface 时，先更新机器事实源，再更新面向使用者的说明，并在 Review 中对照实际 Diff、兼容或迁移影响与测试。默认位置由共享策略维护；领域 Skill 不重复路径表。Harness 自身的 Workflow Interface 仍以 `workflow.yaml` 和 `harness/models/` 为事实源，同目录 `README.md` 只维护用法与示例。

## 开发要求

- 生产行为修改前先写失败测试，并确认失败原因正确。
- 所有 TypeScript 必须通过严格类型检查。
- 不使用 `any` 绕过模型问题。
- 不在多个文件复制同一条流程规则。
- 安装行为变化先在 `tests/install.test.ts` 增加失败测试；安装布局的 Compiler、Runtime 和 Check 行为在 `tests/installed-layout.test.ts` 验证。
- 生成的 Mermaid 和 SVG 只用于展示，不能反向成为事实源。

## 完成验证

```bash
npm run check:all
npm run package:check
npm run doctor
npm run workflow:activate
npm run workflow:validate -- harness/workflows/common-change-execution-policy/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-project-configuration/workflow.yaml
npm run workflow:diagram -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/common-change-execution-policy/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-project-configuration/workflow.yaml
```

## Golden Test

P0 Golden 只锁定核心执行语义：Workflow 的 Step、Check 和 Transition，以及 Runtime 的回改 Cycle、Check 和完成 Trace。Runtime 基线会移除时间、耗时等不稳定字段；Catalog 继续由 `harness/generated/workflow-catalog.json` 和 `workflow:activate --check` 锁定，不维护重复基线。安装和 npm 发布边界使用显式断言与 smoke test，不使用 Golden。

Golden 不会在 CI 自动更新。确认行为变化符合预期后执行：

```bash
UPDATE_GOLDEN=1 npm test
git diff -- tests/fixtures
```

必须在同一个 PR 中审阅并提交实现与 Golden 变化。

## npm 发布

公开包名是 `@jichaowang/harness-graph`。发布前更新 `package.json` 和 `package-lock.json` 中的语义化版本，确保 Git Tag `v<version>` 与包版本完全一致，并发布对应 GitHub Release。`.github/workflows/release.yml` 会从该 Tag 运行完整门禁并通过 npm Trusted Publishing 发布；普通 Branch 和 `main` Push 不会发布。

首次发布是一次性引导步骤：从通过 CI 的 `v0.1.0` Tag 本地执行 `npm publish --access public`，但不要为该 Tag 发布 GitHub Release，避免 Release Workflow 重复发布同一版本。包创建后，在 npm Package Settings 中绑定 GitHub 仓库 `evander-wang/harness-graph`、Workflow `release.yml` 和 Environment `npm`。从下一个版本开始只发布 GitHub Release，由受保护 Environment 审批后通过 OIDC 发布并自动生成 provenance；禁止把长期 npm Publish Token 写入仓库。

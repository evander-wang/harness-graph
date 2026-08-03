# Harness Next Agent 约束

## 修改前必读

依次阅读：

1. `README.md`：项目全局和当前能力。
2. `keywords.md`：五个核心关键词及标准映射。
3. `docs/design.md`：模块、校验顺序和范围。
4. `CONTRIBUTING.md`：新增和修改方式。

本文件只维护强制约束，不重复教程。

## 核心模型

项目对外只使用五个流程概念：`Workflow`、`Step`、`Transition`、`Skill`、`Check`。

- Workflow 使用 Open Workflow Specification `1.0.3`。
- `do` 中的具名 Task 是 Step。
- 声明顺序、`then` 和 `switch` 是 Transition。
- 自定义 `call` 映射本地 Skill。
- `metadata.harness.checks` 绑定本地 Check。

不要为流程图、主路径、Cycle 或审核结果创造新的顶层概念，也不要引入第二套 Workflow 格式。

## 唯一事实源

- 输入输出结构：`harness/models/**/*.schema.json`
- Workflow：`harness/workflows/**/workflow.yaml`
- Check：`harness/checks/**/CHECK.md`
- Skill：`skills/**/SKILL.md`

Mermaid 和其他生成内容只用于展示，禁止手工维护为第二份流程定义。

`harness/generated/workflow-catalog.json` 是路由索引，不是流程事实源。`npm run workflow:sync` 会由全部 Workflow 覆盖生成它；`npm run workflow:activate` 则读取人工维护的 `harness/workflow-activation.yaml`，只写入指定入口及其前置依赖。修改已激活 Workflow 或激活声明后必须执行 `npm run workflow:activate`。

安装到业务项目后，以上发布资产分别位于 `harness-next/workflows/`、`harness-next/models/`、`harness-next/checks/` 和 `harness-next/skills/`；Catalog 和激活声明也位于该 Harness Root。禁止在安装器中维护第二份事实源。

## Workflow 约束

- `document.dsl` 固定使用当前 SDK 支持的 `1.0.3`。
- `document.version` 使用语义化版本。
- 首版只允许自定义 `call` 和 `switch`。
- 自定义 `call` 必须存在对应的 `skills/<call>/SKILL.md`。
- Skill Step 的业务 `input`、`output` 和 Check 都可以省略。
- 固定流转且没有 Check 的 Skill Step 正常完成后视为 `passed`，并记录执行证据。
- Skill Step 的下一节点是 `switch` 时必须绑定至少一个 Check。
- Check 必须返回 `passed`、`needs_changes` 或 `blocked`，并包含可核对的 `evidence`。
- 顺序、分支和回改只能通过标准声明顺序、`then` 和 `switch` 表达。
- Cycle 必须至少存在一条能够到达 Workflow 结束节点的路径。
- `schedule`、远程调用和事件 Task 当前禁止使用。
- Agent 每次只加载当前 Step 对应的 Skill、Check 和必要输入。
- `document.metadata.harness.routing` 声明 Workflow 的 Alias、适用场景和排除场景。
- `document.metadata.harness.execution.maxStepAttempts` 如存在，必须是正整数。
- `switch.when` 当前只允许比较 `.status` 与 `passed`、`needs_changes` 或 `blocked`。

## 本地执行

- `skills/workflow-router/SKILL.md` 是 Agent 进入 Workflow 的唯一入口。
- Router 只读取 Workflow Catalog 的 `entryWorkflows` 路由入口，并自动调用 `workflow:start`、`workflow:continue` 和必要时的 `workflow:cancel`。
- Agent 禁止自行解析 YAML 决定 Transition，后续 Step 只能使用 Runtime 返回结果。
- 一个 Harness Worktree 同时只允许一个 `running` Run；Run 固化目标项目目录。
- Run 固定 Workflow Version 和 Source Hash；Workflow 运行期间发生变化时禁止继续推进。
- Step Result 必须匹配 `runId`、`revision` 和当前 `stepId`，并包含非空 `evidence`。
- 引擎仓库的 `.harness/` 和安装项目的 `harness-next/.state/` 只保存本地运行状态，禁止提交 Git，禁止写入 Secret 和完整 Prompt。
- 第一版不提供宿主 Hook；Agent 或宿主完全重启后，不承诺主动恢复，重新加载 Router 后可以恢复。

## Model 和 Schema

- Workflow 和 Step 的业务输入输出可选；需要结构校验时使用 JSON Schema Draft 2020-12。
- 项目内 Schema URI 使用 `harness://models/<file>.schema.json`。
- URI 必须解析到当前仓库的 `harness/models/`，不得访问网络或逃逸目录。
- Schema 可以通过 `harness://models/` 引用同一工作区内的其他 Model；禁止网络 `$ref`。
- Open Workflow 标准 Schema 由 `@openworkflowspec/sdk` 提供，禁止复制修改。
- 输入输出涉及稳定实体结构时，先声明 JSON Schema，再补充必要 UML 文档。

## 修改位置

- 输入输出变化：修改 `harness/models/`。
- 流程变化：修改对应 `workflow.yaml`。
- 验收规则变化：修改对应 `CHECK.md`。
- Step 执行方式变化：修改对应 `SKILL.md`。
- 编译和校验变化：先写失败测试，再修改 `src/workflow/`。
- 命令行为变化：先写失败测试，再修改 `src/cli.ts`。
- 安装、preflight 或 Root 推导变化：先写失败测试，再修改 `src/installation/`。

禁止在多个文件复制同一条规则。

## 技术约束

- 项目使用 Node.js 22、npm 和严格 TypeScript。
- 不得加入 Python 项目配置、虚拟环境或 Python 实现。
- 不得使用 `any` 绕过类型检查。
- 所有自动检查收口到 `npm run check:all`。
- `@openworkflowspec/sdk` 当前锁定精确版本，升级必须包含兼容性测试。
- Check 的确定性命令只允许 Front Matter 中的 `command`、`args` 和可选 `cwd: harness | workspace` 结构，禁止 Shell 字符串。
- Node.js 项目检查统一使用 `project-check` 识别 npm、Yarn 或 pnpm，禁止在共享质量门禁中写死包管理器。

## 完成标准

报告完成前执行：

```bash
npm run check:all
npm run project:check
npm run doctor
npm run workflow:activate
npm run workflow:validate -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:validate -- harness/workflows/node-project-configuration/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:image -- harness/workflows/node-project-configuration/workflow.yaml
```

## 安全和 Git

- 未经用户明确授权，不得向外部系统上传源代码、凭据、业务数据、图片、Prompt 或经验数据。
- 不得在 Workflow、测试和生成内容中保存 Secret。
- 未经用户明确要求，不得 commit、push、发布或创建远程仓库。
- 保留无关的用户改动，禁止破坏性 Git 命令。
- 建立首个基线后，Feature 和 Bugfix 默认使用独立 Branch 或 Worktree。

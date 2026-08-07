# Harness Graph 作用域资产与可扩展能力优化计划

## 目标

在不增加流程顶层概念的前提下，统一现有 Workflow、Skill、Check 和 Model 的作用域命名，明确公共策略、语言能力、业务项目知识和可选外部 Skill 的职责，使发布资产保持高内聚、低耦合并可持续校验。

## 范围内

- 将现有跨语言资产统一为 `common-` 前缀。
- 将现有 Node.js TypeScript 资产统一为 `node-typescript-` 前缀。
- 同步 Workflow 引用、Schema URI、Activation、Catalog、源码默认路径、测试和当前用户文档。
- 增加仓库级资产命名回归测试，不为业务项目增加新的命名元数据或注册表。
- 将外部 Skill 定义为当前 Step 内的可选方法；不可用时由模型按本地 Skill 完成。
- 在公共变更协议中补齐 `CONTEXT.md`、项目 `STANDARDS.md` 和 `docs/adr/` 的读取、计划和更新时机。
- 明确引擎 `AGENTS.md`、目标项目规则、宿主 Adapter 和 Harness 发布资产的职责。
- 将作用域命名检查接入引擎仓库的 `workflow:validate` 和 `doctor`，避免只靠测试发现遗漏。
- 将 Runtime 已持久化的 Run、Step、Transition、Check、证据、版本和源哈希接入 UI 观察面板。
- 为公共计划 Check 增加知识文档影响清单的回归约束，不新增流程顶层概念。

## 范围外

- 不保留旧资产名称、兼容 Alias 或迁移注册表。
- 不创建假设性的公司脚手架、公司 Workflow 或领域 Workflow。
- 不增加外部 Skill Provider、Adapter、Registry 或版本锁定机制。
- 不增加 Plan、Question、Conversation 等流程顶层概念。
- 不改变 Runtime Transition、用户询问或 Workflow 语义；UI 只增加现有事实的观察入口。
- 不增加新的运行时模型、外部注册表或宿主适配层。

## 预计修改

- `harness/workflows/`、`harness/skills/`、`harness/checks/`、`harness/models/`
- `harness/workflow-activation.yaml` 和生成的 Catalog
- `src/node-project/`、`src/cli.ts` 中的发布资产路径
- `tests/` 中的行为断言和 Golden
- `AGENTS.md`、`README.md`、`keywords.md`、`docs/design.md`、`CONTRIBUTING.md`
- `src/workflow/asset-naming.ts`、`src/workflow/report.ts`、`src/workflow/ui-server.ts`、`web/`

## 主要风险

- 文件路径、Front Matter 名称、Workflow 引用或 Schema `$id` 遗漏会导致安装后找不到资产。
- Golden、UI API 和安装 smoke test 可能仍引用旧名称。
- 运行观察接口若直接读取非 Runtime 数据，会形成第二事实源；因此只从 `.state` 生成报告。

## 验证

- 先用失败测试锁定新命名和旧资产不存在，再完成迁移。
- 执行 `npm run check:all`、`npm run project:check`、`npm run doctor` 和 `npm run workflow:activate`。
- 验证并生成全部四个 Workflow 的流程图和 SVG。
- 全仓搜索活跃源码、发布资产、测试和当前文档中是否残留旧 ID。
- 验证 `workflow:validate`、`doctor` 会报告未迁移的引擎发布资产。
- 验证 UI `/api/runs` 与 `/api/runs/:runId` 只返回 Runtime Report，并展示证据、Check 和 Transition。

## 接口与文档影响

- Harness 发布资产路径、Workflow 名称、Skill/Check ID 和 Model URI 会直接变化；开发阶段不提供兼容层。
- Open Workflow Specification、Runtime `start / continue / cancel` Interface 和 Step Result 结构不变。
- 当前 README、关键词、设计和贡献指南同步更新；历史计划和规格保留原始记录。

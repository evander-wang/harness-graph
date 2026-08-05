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
5. 会修改项目文件的入口 Workflow 必须在 `document.metadata.harness.prerequisites` 中声明 `change-execution-policy`；语言 Standards 使用另一个前置 Workflow 组合，禁止复制通用执行协议。
6. 使用自定义 `call` 绑定本地 Skill。
7. 固定流转可以不绑定 Check；进入 `switch` 前必须在 `metadata.harness.checks` 中绑定 Check。通用 Check 和领域 Check 可以在同一 Step 组合，领域 Check 不重复通用规则。
8. 使用声明顺序、`then` 和 `switch` 表达流程；`when` 只允许比较标准 Check 状态。
9. 为主流程、所有分支、回改 Cycle 和错误声明添加测试。
10. 若 Workflow 需要被 Router 使用，在 `harness/workflow-activation.yaml` 中维护其入口 YAML 路径，并执行 `npm run workflow:activate` 更新 Catalog；`workflow:sync` 仅用于生成全量 Catalog。
11. 执行 `workflow:validate`、`workflow:diagram` 和 `workflow:image` 检查结果。

初始化或规范化 Node.js TypeScript 工程时参考 `node-project-configuration/workflow.yaml`。Input 的 `projectRoot` 指定本地目标目录，默认为当前目录；`project-check` 自动识别 npm、Yarn 或 pnpm。

## 修改位置

| 修改内容 | 修改位置 |
| --- | --- |
| Workflow 输入输出 | `harness/models/` |
| Step 和 Transition | 对应的 `workflow.yaml` |
| Step 执行方法 | `skills/<skill-id>/SKILL.md` |
| 通用修改协议 | `skills/load-change-execution-policy/SKILL.md`；入口 Workflow 只声明 prerequisite |
| 项目 Skill 规范入口 | `skills/harness-graph/SKILL.md`；宿主 Adapter 由安装器生成 |
| Step 验收规则 | `harness/checks/<check-id>/CHECK.md` |
| Workflow 路由索引 | 维护 `harness/workflow-activation.yaml`，执行 `npm run workflow:activate`，禁止手工修改 Catalog |
| 本地运行状态和跳转 | `src/workflow/runtime.ts` |
| Workflow 执行摘要 | `src/workflow/report.ts`；执行记录由 `src/workflow/runtime.ts` 写入 |
| Check 命令执行 | `src/workflow/checks.ts` |
| 包管理器识别和 Node.js 项目门禁 | `src/node-project/` |
| 标准解析和本地校验 | `src/workflow/compiler.ts` |
| CLI | `src/cli.ts` |
| 项目本地安装、preflight 和 Root 推导 | `src/installation/` |

发布资产仍从本仓库的 `harness/` 和 `skills/` 读取；安装器把它们复制到业务项目的 `harness-graph/`，不能在安装代码中维护第二份 Workflow、Model、Check 或 Skill 清单。`workflow-activation.yaml` 中的入口路径相对 Harness Root，使用 `workflows/<name>/workflow.yaml`。

Runtime 发布包由 `src/installation/runtime-package.ts` 投影：只保留运行所需生产依赖，并在安装时生成专用生产 Lockfile；`src/installation/runtime.ts` 负责 Runtime 内容哈希。Runtime 版本或实现变化时，必须补充安装测试覆盖首次安装、重复 install、运行中 Run 阻断和失败回滚。执行 trace 和报告必须统一从 Runtime/Report 模块生成，不能在各个 Workflow 或 Step Skill 中重复实现。

Open Workflow 的标准 Schema 由 `@openworkflowspec/sdk` 提供，禁止复制后手工维护。

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
npm run doctor
npm run workflow:activate
npm run workflow:validate -- harness/workflows/change-execution-policy/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:validate -- harness/workflows/node-project-configuration/workflow.yaml
npm run workflow:diagram -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/change-execution-policy/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:image -- harness/workflows/node-project-configuration/workflow.yaml
```

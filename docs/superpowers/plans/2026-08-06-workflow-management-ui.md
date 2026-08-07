# Workflow 管理页面计划

## 目标

为 Harness Graph 增加一个本地可运行的 Workflow 管理页面，让不熟悉 YAML 的用户能够：

- 浏览当前 Harness Root 中的 Workflow；
- 通过可拖拽、可缩放的流程画布理解 Step、Check 和 Transition；
- 点击节点查看它关联的 Skill、Check 以及 Workflow/Model 文件内容；
- 看到入口 Workflow、版本、前置 Workflow 和编译状态。

## 范围内

- 新增无第三方前端框架的 `web/` 静态页面、样式和交互逻辑；
- 新增 Node.js 内置 HTTP 本地服务，调用现有 `buildWorkflowCatalog()` 和 `compileWorkflow()` 生成页面数据；
- 新增 `npm run workflow:ui` 启动命令；
- 提供 Workflow、节点、关联文件和文件内容的只读 API；
- 覆盖桌面端三栏工作台和窄屏端可用布局；
- 增加针对 UI 服务关键数据路由和路径安全的测试。

## 范围外

- 不修改 Open Workflow DSL、Compiler、Runtime、Catalog 事实源或安装目录协议；
- 不在页面编辑、保存或执行 Workflow；
- 不新增数据库、登录、远程 API 或上传能力；
- 不维护 Workflow 的第二份手写定义；
- 不引入 React、Tailwind 或新的运行时依赖。

## 预计修改文件

- `scripts/copy-workflow-ui.mjs`
- `src/workflow/ui-server.ts`
- `web/index.html`
- `web/app.js`
- `web/styles.css`
- `package.json`
- `src/cli.ts`
- `eslint.config.js`
- `tests/workflow-ui-server.test.ts`
- `tests/install.test.ts`
- `tests/runtime-package.test.ts`
- `docs/superpowers/plans/2026-08-06-workflow-management-ui.md`

## 主要风险

- 浏览器页面无法直接访问本地文件，因此需要本地服务提供只读数据；
- API 文件读取若不限制路径，可能越出 Harness Root；
- SDK FlatGraph 节点 ID 与 Workflow Step ID 需要稳定映射；
- 没有浏览器自动化依赖，页面验证主要通过服务端测试、构建、静态检查和手工启动检查完成。

## 验证方式

- `npm run check:all`
- `npm run project:check`
- `npm run doctor`
- `npm run workflow:activate`
- `npm run workflow:validate -- harness/workflows/common-change-execution-policy/workflow.yaml`
- `npm run workflow:validate -- harness/workflows/node-typescript-standards/workflow.yaml`
- `npm run workflow:validate -- harness/workflows/node-typescript-development/workflow.yaml`
- `npm run workflow:validate -- harness/workflows/node-typescript-project-configuration/workflow.yaml`
- 启动 `npm run workflow:ui` 后请求 `/api/workflows` 和 `/api/workflows/:name`，确认返回真实 Workflow、图数据和关联文件内容。

## 接口与文档影响

- 机器事实源仍为 `harness/workflows/`、`harness/skills/`、`harness/checks/` 和 `harness/models/`；页面数据由现有 Compiler 运行时生成；
- 新增本地只读 HTTP API，使用说明写在 `README.md` 的本地开发章节；
- API 不改变已有 CLI 或发布包协议；`workflow:ui` 仅服务引擎仓库的开发工作台。

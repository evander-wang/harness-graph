---
name: node-typescript-analyze-project
description: 分析目标目录的 Node.js TypeScript 工程现状，生成可执行的项目配置方案。
---

# 分析 Node.js TypeScript 项目

只分析 Workflow Input 的 `projectRoot`。除已加载的通用执行协议允许的计划文件外，不得修改生产代码或配置。路径不存在或为空时按新项目处理。完整读取目标目录适用的 `AGENTS.md`、`package.json`、根 Lockfile、TypeScript、ESLint、测试、构建、环境配置、README、CI 和可选 Docker 配置。

## 判断项目状态

- 根目录没有 `package.json`：`projectState` 为 `new`，默认 npm。
- 已有 `package.json`：`projectState` 为 `existing`，保留现有 npm、Yarn 或 pnpm。
- 优先读取 `package.json#packageManager`，再检查根目录 Lockfile。
- 忽略 `node_modules/.package-lock.json`。
- 多个根 Lockfile、声明与 Lockfile 冲突、已有项目没有任何包管理器证据时返回 `blocked`，不得自行删除文件或选择迁移方向。

## 生成目标 Profile

输出完整 `NodeProjectProfile`、计划修改文件、保留决定、风险和验证方式。

按照已加载的通用执行协议将新项目初始化和其他非平凡任务的计划先向用户展示，再写入协议选定的计划文件；在 evidence 中记录 `planPath=<相对 Workspace Root 的路径>`。计划必须声明接口与文档影响；没有影响时明确写“无”。

新项目必须从用户请求中确定 `service`、`cli` 或 `library`；无法确定时返回 `blocked`。默认使用 Node.js 24、npm、ESM、strict TypeScript、`src/`、`test/`、ESLint、Vitest 和标准 scripts。

已有项目保留模块系统、目录、测试框架和有意设计的构建入口。只补缺失能力或修复有证据的矛盾，不把推荐做法当成迁移授权。

## 必须检查

- `packageManager`、Lockfile、安装命令是否一致；
- `engines.node`、`.nvmrc`、Docker 和 CI 的 Node.js Major 是否一致；
- `typecheck`、`lint`、`test`、`build`、`check:all` 是否存在且语义正确；
- TypeScript 最终配置是否启用 `strict`；
- ESLint 是否禁止 `any` 绕过类型检查；
- README、CI、实际 scripts 是否一致；
- `.env`、TOML 或其他配置文件是否可能跟踪 Secret，只记录字段和策略，不输出 Secret 值；
- Docker、数据库、日志和健康检查是否确实属于需求或已有能力。

证据必须指向实际文件、字段或命令，不使用“看起来合理”作为依据。

---
name: node-typescript-configure-project
description: 根据已通过的 NodeProjectProfile 初始化或规范化当前 Node.js TypeScript 项目。
---

# 配置 Node.js TypeScript 项目

只在已固化的 `projectRoot` 执行通过的配置方案。目标目录不存在时可以创建该目录；不得修改目标目录之外的业务文件。修改前完整读取每个目标文件，保留无关用户改动。

从 Runtime 返回的聚合 evidence 中定位 `planPath=`。存在该证据时，先完整读取计划文件，再按其中已通过的 Profile、范围和“接口与文档影响”配置项目；实际调查需要扩大范围时，先停止配置、更新计划并向用户说明。新增或修改公开 Interface、Schema、CLI、事件或配置契约时，先更新计划指定的机器事实源，再同步面向使用者的说明和示例。

## 新项目

开始配置前完整读取同目录的 `BASELINE.md`。除非用户约束或项目类型明确要求不同方案，必须使用该版本化基线；偏离时在结果中说明原因。

默认基线：

- Node.js 24、npm、ESM；
- `package.json` 声明准确的 `packageManager` 和 `engines.node`；
- `.nvmrc` 与 CI 使用同一 Node.js Major；
- `src/`、`test/`、`dist/`；
- `tsconfig.json` 使用 `NodeNext`、strict TypeScript、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`；
- 使用 TypeScript、`tsx`、ESLint、`typescript-eslint`、Vitest 和 `@types/node`；
- 标准 scripts：`dev`、`typecheck`、`lint`、`test`、`build`、`check:all`，`service` 和 `cli` 按需增加 `start`；
- `.gitignore`、README 和 `.github/workflows/ci.yml`；
- 配置存在 Secret 时只提交示例字段或 Schema，真实值放入未跟踪的本地文件或环境变量。

使用 npm 安装依赖并生成 `package-lock.json`。不得手写 Lockfile。

## 已有项目

- 使用识别出的包管理器修改依赖和 Lockfile；
- 保留现有模块系统、测试框架、目录和构建工具；
- 缺少标准 script 时优先增加指向现有命令的 Alias；
- script 名称与语义明显矛盾时，在计划中列明兼容性影响后修正，不静默改变；
- 统一有明确事实源的 Node.js 版本；
- 不自动迁移包管理器、模块系统、测试框架、数据库或部署方式；
- 不删除已有功能、配置和看起来有意保留的 script；
- 不直接修改生成物，修改生成源后执行项目原有生成命令。

## 代码质量

- 不使用 `any` 绕过类型检查；
- 外部依赖 Interface 从当前安装版本和类型声明确认；
- 行为变化先写失败测试；
- 单调用点的单行 Helper 优先内联；
- 使用顶层 import，不引入无必要的动态 import；
- 需要 Node.js strip-only 模式时只使用 erasable TypeScript syntax。

输出实际修改文件、依赖变化、执行命令和仍需验证的风险。

# Skill 源码布局迁移计划

## 目标

将引擎仓库的 Skill 发布源从根目录 `skills/` 迁移到 `harness/skills/`，使源码布局与 Harness Root 的事实源组织一致；安装到业务项目后的路径继续保持 `harness-graph/skills/`。

## 范围内事项

- 移动全部源码 Skill 目录和 Skill README 到 `harness/skills/`。
- 更新开发态 Harness Root 路径解析和安装载荷复制，使其读取新的源码路径。
- 更新编译器、测试夹具、npm 发布白名单和文档中的源码路径引用。
- 增加或调整回归测试，覆盖源码 `harness/skills/` 可编译、安装后 `harness-graph/skills/` 可运行，以及旧根目录 Skill 不再作为源码事实源。

## 范围外事项

- 不改变安装项目的 `harness-graph/skills/` 目录布局。
- 不改变 `.agents/skills/`、`.claude/skills/` 宿主 Adapter 路径。
- 不改变 Workflow、Check、Model 的结构或运行语义。
- 不做版本发布、提交或远程操作。

## 预计修改文件

- `harness/skills/**`（从 `skills/**` 迁移）
- `src/installation/paths.ts`
- `src/installation/payload.ts`
- `src/installation/project-skills.ts`
- `src/installation/legacy-assets.ts`
- `src/workflow/compiler.ts`
- `package.json`
- `README.md`、`keywords.md`、`docs/design.md`、`CONTRIBUTING.md`、`AGENTS.md`
- `docs/superpowers/specs/2026-07-21-node-project-configuration-design.md`
- `docs/superpowers/specs/2026-08-03-project-local-installation-design.md`
- 相关 `tests/*.test.ts`

## 主要风险

- 遗漏源码路径引用会导致编译、Catalog 同步或 npm 安装失败。
- 开发态路径与安装态路径混用会产生错误的 Skill 路径证据。
- 旧用户工作区中的已安装资产不应被此源码布局迁移破坏。

## 验证方式

- 先运行受影响的 Compiler、Catalog、安装和发布测试，确认失败原因与旧路径有关。
- 完成迁移后运行 `npm run check:all`、`npm run project:check`、`npm run doctor`、`npm run workflow:activate`。
- 验证四个标准 Workflow 的 validate 和 image 命令，以及真实 npm pack/install smoke test。

## 接口与文档影响

- 机器事实源：源码 Skill 路径从 `skills/<id>/SKILL.md` 变为 `harness/skills/<id>/SKILL.md`；安装后的事实源路径不变。
- 面向使用者的说明：更新 `README.md`、`keywords.md`、`docs/design.md`、`CONTRIBUTING.md` 和 `AGENTS.md` 中的源码路径。
- 兼容性：不兼容直接读取引擎仓库根 `skills/` 的内部脚本或外部消费者；npm 安装载荷和业务项目布局保持兼容。

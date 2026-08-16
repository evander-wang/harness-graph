# Install 发布资产预览与覆盖

## 目标

允许用户预览 npm 包与项目本地 Harness 发布资产的差异，并在显式确认后安全覆盖。

## 范围内事项

- `install --diff [workspace]` 输出逐文件 unified diff，不修改项目。
- 普通 `install [workspace]` 在已有安装存在资产差异时先显示 Diff，并在交互终端询问确认后覆盖。
- `--yes` 为脚本或非交互环境提供显式确认，不要求额外的覆盖参数。
- 覆盖发布源中已经变化或新增的 Workflow、Model、Check、Skill、激活声明；保留目标端额外的用户自定义文件。
- 覆盖前检查运行中的 Run；覆盖失败时回滚；成功后重建 Catalog。
- 用户拒绝覆盖时，`install` 继续升级 Runtime 和托管入口，并通过 `maintainedEntries` 报告差异。
- 为公开行为补充安装与 CLI 回归测试。

## 范围外事项

- 不自动删除只存在于目标项目中的发布资产。
- 不提供逐文件选择的交互式 TUI。
- 不在默认 `install` 中静默覆盖发布资产。
- 不覆盖业务项目中 Harness Root 之外的用户内容。

## 预计修改文件

- `src/installation/payload.ts`
- `src/installation/installer.ts`
- `src/cli.ts`
- `tests/install.test.ts`
- 必要的 CLI 测试文件
- `README.md`
- `docs/design.md`

## 主要风险

- 用户对发布资产的定制被覆盖。
- 覆盖中断造成新旧资产混合。
- Workflow 源变化使运行中的 Run 无法继续。
- 激活 Catalog 与覆盖后的 Workflow 不一致。

通过默认只预览、显式确认、运行状态阻断、临时备份与失败回滚、覆盖后 Catalog 激活来控制风险。

## 验证方式

1. 先增加失败测试并确认失败原因来自能力尚未实现。
2. 运行安装与 CLI 相关 Vitest。
3. 执行 `npm run check:all`、`npm run project:check`、`npm run doctor` 和项目要求的 Workflow 校验/图片命令。

## 接口与文档影响

- 新增公开 CLI flags：`install --diff` 和 `install --yes`；普通 `install` 自动处理交互确认。
- CLI 参数解析和安装 Module Interface 是机器可执行事实源。
- `README.md` 增加面向用户的升级、Diff、确认覆盖和自动化用法。
- `docs/design.md` 记录默认保留和显式覆盖的兼容、安全语义。
- 普通 `install [workspace]` 新增 Diff 和交互确认，但用户拒绝时仍保持原先的资产保留语义。

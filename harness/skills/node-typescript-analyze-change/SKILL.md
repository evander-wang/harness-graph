---
name: node-typescript-analyze-change
description: 分析 Node.js TypeScript 变更的目标、范围、依赖、风险和验证方式。
---

# 分析 Node.js TypeScript 变更

## 可选外部能力

根据任务实际情况选择外部 Skill，不要求必须加载。它们只提供当前 Step 的思考方法，不拥有计划文件或项目知识文档：

- 需求或方案不清晰时，可以使用 `superpowers/brainstorming` 或 `mattpocock/skills/grill-with-docs`；
- 需要调查外部技术事实时，可以使用 `mattpocock/skills/research`；
- 明确是缺陷且根因未知时，可以使用 `superpowers/systematic-debugging` 或 `mattpocock/skills/diagnosing-bugs`。

如果当前宿主无法发现这些 Skill，直接根据本 Skill 的目标和要求完成分析。`brainstorming`、`grill-with-docs` 和 `research` 只能辅助只读分析；计划仍按共享协议展示并落盘，`CONTEXT.md`、项目 `STANDARDS.md` 和 `docs/adr/` 仍由计划 Check 通过后的实施 Skill 更新。外部 Skill 不改变当前 Step 的写入范围、输出要求、Check 或 Transition。

完整阅读相关模块、项目约束、配置和测试，不依赖搜索片段做大范围判断。

涉及外部库时检查当前安装版本的导出、类型声明和官方用法，不猜测 Interface。

输出目标、范围内事项、范围外事项、预计修改文件、兼容性影响、风险、验证命令以及接口与文档影响；接口与文档影响必须覆盖相关的 `CONTEXT.md`、项目 `STANDARDS.md` 和 `docs/adr/`。

按照已加载的通用执行协议判断任务是否属于非平凡任务。先向用户展示计划；需要落盘时，再将同一份计划写入协议选定的计划文件，并在 evidence 中记录 `planPath=<相对 Workspace Root 的路径>`。简单任务不创建计划文件时，evidence 必须记录原因。

除展示后的计划文件外只分析，不得修改生产代码或配置。计划通过 Check 后才能进入实现。

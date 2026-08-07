# Skill

每个 Skill 使用独立目录：

```text
harness/skills/<skill-id>/SKILL.md
```

Workflow 中的自定义 `call` 值就是 Skill ID。Agent 执行当前 Step 时只加载对应 `SKILL.md`、可选的 Check 和必要输入。

Skill 的业务输入和输出都可以省略。没有 Check 的固定流转 Step 在 Skill 正常完成后视为 `passed`，并记录执行证据；配置 Check 时由 Check 返回 `passed`、`needs_changes` 或 `blocked`。

Skill 不得自行决定或执行后续 Step。

## Workflow 入口

`harness/skills/harness-graph/SKILL.md` 是面向用户和宿主的规范入口。安装器生成的 `.agents/skills/harness-graph/SKILL.md` 与 `.claude/skills/harness-graph/SKILL.md` 只负责加载它，不复制路由规则。

`harness/skills/workflow-router/SKILL.md` 是唯一 Runtime Workflow 入口。规范入口把完整用户请求和显式 Workflow 名称交给它；Router 只读取生成的 Catalog，选择一个入口 Workflow，并自动调用项目本地 Runtime。

Workflow 完成后，Router 可询问用户是否通过项目本地 `report <run-id> --format markdown` 输出执行摘要；执行 trace 始终由 Runtime 保存到 Run 状态。

普通 Step Skill 不对用户承诺完整流程，也不得绕过 Runtime 加载后续 Skill。

## 通用变更执行协议

`common-load-change-execution-policy` 是修改类 Workflow 的通用执行协议唯一事实源。入口 Workflow 通过 `common-change-execution-policy` 前置 Workflow 加载它；语言和领域 Skill 只能增加具体约束，不能复制或削弱通用协议。

Router 只实现协议要求的暂停和恢复方式。当前 Step 缺少可由用户补充的决定时，不写 Step Result、不调用 `continue`；用户回答后继续同一个 Run。

## Node.js 项目配置

`node-typescript-analyze-project`、`node-typescript-configure-project`、`node-typescript-verify-project`、`node-typescript-review-project-configuration` 和 `node-typescript-deliver-project-configuration` 共同完成 Input 中 `projectRoot` 指向的本地工程初始化或规范化。新项目使用 `node-typescript-configure-project/BASELINE.md` 的版本化默认值。

新项目默认 npm；已有项目保留已确认的 npm、Yarn 或 pnpm。Skill 不自行删除冲突 Lockfile，不迁移模块系统或测试框架，也不在证据和结果中记录 Secret 值。

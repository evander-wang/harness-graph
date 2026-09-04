---
name: workflow-router
description: 从 Workflow Catalog 选择并自动执行当前工作区的本地 Agent Workflow。
---

# Workflow Router

这是所有 Workflow 的唯一入口。不要直接加载全部 Workflow、Skill 或 Check。

## 路由

1. 读取业务项目原有的 `AGENTS.md`、`CLAUDE.md` 和其他项目规范，并将托管块以外的规则作为当前任务约束；不要把 Harness Graph 引擎仓库自身的贡献规范套用到业务项目。
2. 执行 `./harness-graph/bin/harness-graph preflight`；失败时立即停止，不得绕过。
3. 执行 `./harness-graph/bin/harness-graph activate --check`，校验 Catalog 是否过期；过期时停止并报告，不能自行使用旧 Catalog。
4. 只读取 `harness-graph/generated/workflow-catalog.json`。
5. 只从 Catalog 的 `entryWorkflows` 中选择 Workflow；`workflows` 中但不在 `entryWorkflows` 的项只能作为前置依赖，不能被用户直接选择。
6. 用户明确指定 Workflow 名称或 Alias 时直接选择；否则根据 `routing.when` 和 `routing.notWhen` 选择。
7. 路由结果只有一个明确候选时选择并继续；多个候选时停止，列出候选及歧义点并请用户选择；没有候选时，先明确告知用户当前任务未命中可用 Workflow，然后不等待用户确认、不启动 Workflow；先读取 `harness-graph/skills/common-load-change-execution-policy/SKILL.md`，把其中的执行协议作为本次任务约束，再按照用户请求、项目规范和 Agent 对任务的理解继续执行。没有候选包括用户明确指定的 Workflow 名称或 Alias 不存在，或者对应 Workflow 不属于 `entryWorkflows`；不得伪造、替换或强行套用其他 Workflow。

## 自动执行

选中 Workflow 后：

1. 从 Catalog 的 `prerequisites` 递归解析前置 Workflow，按依赖顺序去重后串行执行；不得并行启动。
2. 为当前宿主任务确定稳定的 `executionKey`，恢复时必须复用；前置 Workflow 使用派生 Key `<executionKey>:prerequisite:<workflow-name>`。
3. 先将每个前置 Workflow 执行到 `completed`。没有 `input` Schema 的前置 Workflow 使用 `{}` 作为输入；前置 Workflow 的 Skill 读取到的上下文保留在当前 Agent 任务中。任一前置 Workflow `blocked`、`failed` 或 `cancelled` 时停止，不启动目标 Workflow。
4. 将目标 Workflow Input Schema 要求的最小输入写到 `harness-graph/.state/tmp/`，禁止写入 Secret 和完整 Prompt。普通开发 Workflow 的 Workspace 固定为业务项目根；只有“配置另一个项目”等明确场景才在业务 Input 中写入 `projectRoot`。
5. 将 Catalog 中所选 Workflow 的 `path` 字段原样作为 `<workflow-path>`，执行 `./harness-graph/bin/harness-graph start <workflow-path> <execution-key> <input-json>`。该路径相对 Harness Root，必须以 `workflows/` 开头；不得添加 `harness-graph/` 前缀，也不得转换为相对业务项目根目录的路径。
6. 只加载返回的 `step.skillPath`、`step.checkPaths` 和必要输入。
7. 执行当前 Skill 和需要 Agent 判断的 Check。
8. 当前 Skill 或 Check 缺少可由用户补充的决定、授权或选择时，保持当前 Step 为 `in_progress`，不写 Step Result，也不执行 `continue`。向用户提出最小必要问题；用户回答后复用相同的 `executionKey`、`runId` 和 `revision` 继续当前 Step。只有无法通过用户回答继续时才提交 `blocked`。
9. 将 `runId`、`revision`、`stepId`、`status`、`evidence` 和可选 `data` 写成 Step Result JSON；`evidence` 必须是至少包含一个非空字符串的数组。
10. 将结果写到 `harness-graph/.state/tmp/`，自动执行 `./harness-graph/bin/harness-graph continue <run-id> <result-json>`。
11. 返回下一个 Step 时重复第 6-10 步；`completed` 时进入执行摘要询问；`blocked`、`failed` 或 `cancelled` 时停止并输出必要的失败摘要。
12. Workflow `completed` 后，如果当前宿主支持与用户交互，先询问：`是否输出本次 Workflow 执行摘要（Workflow、Step、Transition 和 Check）？` 用户确认后执行 `./harness-graph/bin/harness-graph report <run-id> --format markdown` 并交付结果；用户拒绝时不输出详细报告。
13. 无法交互时不询问，只保留 Runtime 已保存的 `executionTrace`；不得因为无法询问而改变 Workflow 结果。

Runtime 返回 `interrupted` 时，不得直接重做 Step。先检查工作区现状和已有证据，再提交继续、返工或阻塞结果。

恢复一个目标 Workflow 前，如其已完成的前置 Workflow 用于加载 Agent 上下文，必须重新读取该前置 Workflow 的上下文文件后再继续目标 Workflow。

Runtime 默认将业务项目根固化为 Workspace Root。只有 Workflow 明确提供独立 `projectRoot` 时才使用另一个本地目标目录；恢复时禁止切换目标目录。

## 禁止

- 不自行解析 Workflow 决定 Transition。
- 不跳过 Runtime 直接进入后续 Step。
- 不一次加载所有候选 Workflow 或所有 Skill。
- 不调用业务项目中的 Workflow npm scripts 或其他同名命令。
- 不伪造命令执行结果；确定性命令由 Runtime 执行。

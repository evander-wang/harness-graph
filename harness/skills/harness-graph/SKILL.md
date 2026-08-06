---
name: harness-graph
description: 进入并执行当前项目安装的 Harness Graph Workflow。Use when the user invokes $harness-graph or /harness-graph, names a Workflow or Alias, asks to run or recover a Workflow, or requests a project code or configuration change.
---

# Harness Graph

将适用的 `AGENTS.md`、`CLAUDE.md` 和用户请求作为整个任务的约束。本 Skill 只增加执行方式，不削弱或覆盖项目约束。

## 进入 Workflow

1. 保留完整用户请求作为路由意图；用户明确指定的 Workflow 名称或 Alias 是强制选择，不是建议。
2. 定位包含 `harness-graph/bin/harness-graph` 的项目根目录；找不到唯一入口时停止并报告。
3. 从项目根执行 `./harness-graph/bin/harness-graph route`。
4. 要求命令成功，并且 stdout 只包含一个 JSON 对象。
5. 要求 `kind` 是 `harness-graph.router-directive`，只加载 `routerSkillPath` 指向的 Skill。
6. 针对当前用户请求完整执行 Router Skill。

没有显式 Workflow 时，由 Router 只从 Catalog 的 `entryWorkflows` 中选择。显式名称不存在、有歧义或不是入口 Workflow 时停止，不替换成其他 Workflow。

## 禁止

- 不直接执行用户点名的内部 Step Skill。
- 不自行解析 Workflow YAML 决定 Transition。
- 不跳过 preflight、Check、前置 Workflow 或 Runtime 状态。
- 不使用全局 Harness Graph 或业务项目中的同名命令。
- 不伪造 Workflow、Step Result 或执行证据。
- 不把 Secret 或完整 Prompt 写入 `.state/`。

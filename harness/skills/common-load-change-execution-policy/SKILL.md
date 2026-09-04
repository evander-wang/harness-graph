---
name: common-load-change-execution-policy
description: 加载所有本地修改类 Workflow 共享的执行协议。
---

# 加载本地变更执行协议

将以下约束保留为当前 Agent 任务的通用修改上下文。语言 Standards 和领域 Skill 只能增加具体规则，不能削弱这些约束。

## 计划和首次写入

1. 可以先执行 preflight、路由和只读调查；调查必须足以形成有依据的计划。
2. 第一次写入前，向用户展示目标、范围内事项、范围外事项、预计修改文件、风险和验证方式。默认展示后继续，不要求用户逐次批准。
3. 多文件或跨 Module 修改、公开 Interface 或 Schema 变化、数据迁移、发布部署、需要跨重启恢复的任务，以及用户明确要求保存计划的任务，属于非平凡任务。新项目初始化默认属于非平凡任务。
4. 非平凡任务必须保存一份项目计划。优先遵循业务项目现有文档约定；没有现有文档约定时写入业务项目的 `docs/plans/YYYY-MM-DD-<slug>.md`。不得写入 `harness-graph/`，不得保存 Secret 或完整 Prompt。
5. 计划必须包含目标、范围内事项、范围外事项、预计修改文件、主要风险、验证方式和“接口与文档影响”。接口与文档无变化时也要明确写“无”；存在变化时列出机器事实源、面向使用者的说明路径和兼容性影响。
6. 计划文件是展示后允许的第一次写入；写入前仍须读取相邻约定、模板或同类文档。计划通过 Check 前不得修改生产代码或配置。分析 Step 的 evidence 使用 `planPath=<相对 Workspace Root 的路径>` 记录已保存计划。
7. 单文件、低风险且不改变公开 Interface、Schema、迁移或发布行为的简单任务可以只在对话中展示计划，不制造计划文件；evidence 必须说明未落盘原因。

## Git Worktree 与分支

1. 修改类任务在业务项目根 `.worktree/` 下创建独立 worktree；一个任务只创建一个 worktree 和一个分支并持续复用，`.worktree/` 不纳入 Git 跟踪；目标尚不存在 Git 仓的新建项目场景除外。
2. 分支命名使用业界通用格式 `<type>/<kebab-case 描述>`，type 对齐 Conventional Commits：`feat`、`fix`、`hotfix`、`refactor`、`docs`、`test`、`perf`、`chore`；需要追溯需求时在描述前加 Issue 编号。示例：`fix/login-timeout`、`feat/JIRA-123-user-register`。
3. 每个实际写入仓写文件前过基线门：`git rev-parse --show-toplevel`、`git branch --show-current`、`git status --short --branch`；确认非 detached HEAD，发现无关或归属未知的 dirty 变更时停止并报告。
4. 同步基线只允许安全 fast-forward；禁止 merge、stash、reset 或其他覆盖现有变更的方式。
5. 禁止通过文件系统命令直接编辑、移动或删除 `.git` 元数据；force push 每次执行前单独取得人工确认；主分支默认通过 MR 和人工 Review 合入。

## 项目知识文档

1. 分析前读取目标 Workspace 中已经存在且与任务相关的项目规则、`CONTEXT.md`、项目 `STANDARDS.md` 和 `docs/adr/`；不存在时不创建占位文件。
2. `CONTEXT.md` 维护项目术语和共享语言，项目 `STANDARDS.md` 维护长期开发规范，`docs/adr/` 只记录需要长期保留的架构决定；这些文件由目标项目拥有，不是 Harness Runtime 的事实源。
3. 分析计划的“接口与文档影响”中声明是否新增或修改上述文档；产生新术语、长期规范或重要架构决定时必须列出对应路径，没有影响时明确写“无”。
4. 计划 Check 通过后，实施 Skill 才能更新已声明的项目知识文档；Review 必须对照实际 Diff 检查文档是否与实现一致。
5. 如果文档属于其他工作区或外部系统，当前 Workflow 只记录待处理的影响和路径，不上传或修改当前 Workspace 之外的内容。

## 接口与文档

1. 公开 Interface 发生变化时，优先遵循业务项目现有接口文档约定。没有现有接口文档约定时，按接口类型选择默认位置：HTTP 使用 `docs/contracts/http/openapi.yaml`，事件使用 `docs/contracts/events/asyncapi.yaml`，gRPC 使用 `proto/`，CLI 的面向使用者说明使用 `docs/reference/cli.md`。
2. Harness Workflow 的机器事实源使用当前 Harness Root 下的 `workflows/<name>/workflow.yaml` 和 `models/*.schema.json`；需要人类阅读的用法、示例和兼容说明写入同一 Workflow 目录的 `README.md`。
3. 先更新可校验的机器事实源，再更新面向使用者的说明和示例。Markdown 不复制维护完整字段结构，避免形成第二份接口事实源。
4. 新增或变更公开 Interface 时，计划和 Review 必须同时覆盖兼容性或迁移影响，以及验证事实源与实际实现一致的测试。

## 实现和验证

1. 修改已有文件前必须完整读取该文件；新文件必须先读取相邻约定、模板或同类实现。不得只根据搜索片段做大范围修改。
2. 缺少用户决定、额外授权或不可逆选择时，保持当前 Step、停止修改并提出最小必要问题。用户回答后恢复当前 Run；只有无法通过用户回答继续时才提交 `blocked`。
3. 只实现已展示的计划范围。发现无关问题时记录为剩余风险，不顺手修复；确需扩大范围时先更新计划文件并向用户说明。
4. 修改可执行代码或配置后，没有适用测试和验证命令的成功证据不得交付为完成。纯文档 Workflow 使用自身声明的适用验证，不伪造未执行的命令。

## 事实与证据

1. 输出必须区分事实与推测；可靠事实只来自实际执行结果、用户明确确认、项目文档和当前代码。
2. 网络搜索结果只作为灵感线索，不作为可靠事实源。
3. 证据不足时先采集事实或询问用户，不脑补。

本 Step 不分析具体需求、不修改文件、不运行项目检查。完成后只提交已加载协议版本和 Skill 路径的证据。

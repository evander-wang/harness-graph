# Harness Graph 设计

## 设计目标

让标准 `workflow.yaml` 成为本地 Agent 流程的唯一事实源。贡献者修改流程时只需要找到对应 Step、Skill、Check 或 Model，不需要理解一套自研调度系统。

## 核心决定

1. Workflow 完全采用 Open Workflow Specification，不维护第二套流程格式。
2. 自定义 `call` 映射本地 Skill，`metadata.harness.checks` 绑定本地 Check。
3. Open Workflow SDK 只作为内部实现依赖，不把 SDK 类型扩散到 CLI 和目录约定。
4. 所有 Workflow、Skill、Check 和 Model 都从 Harness Root 读取，目标 Workspace 只允许本地目录，不访问远程执行目标。
5. 修改类入口 Workflow 通过前置 Workflow 组合通用执行协议和语言 Standards；入口只维护路由与 Transition，不复制前置规则。

## 发布资产命名与职责分工

发布资产使用作用域前缀，保持全局可发现；Workflow 内部 Step 只使用局部简短 ID。现有资产在开发阶段统一采用该规则，不保留旧 ID 兼容层。

| 作用域 | 前缀 | 示例 |
| --- | --- | --- |
| Harness 跨语言公共能力 | `common-` | `common-change-execution-policy` |
| 语言或技术栈能力 | `<language>-` | `node-typescript-standards`、`go-quality-gate` |
| 公司内部能力 | `<company>-` | `inke-go-standards` |
| 业务领域能力 | `<domain>-` | `billing-change-review` |

`harness-graph` 和 `workflow-router` 是产品入口保留名。公司或领域资产只有存在真实的规范、CLI、模板或验收需求时才创建；没有真实能力时不创建占位脚手架。

开发规范和公司扩展能力按职责拆分，避免把同一条规则复制到 Workflow、Skill、Check 和文档中。语言标准与公司标准通过前置 Workflow 组合，具体执行和验收仍由各自的 Skill、Check 负责。

| 职责 | 唯一事实源或实现位置 |
| --- | --- |
| 语言编码标准 | `harness/workflows/<language>-standards/STANDARDS.md`，例如 `node-typescript-standards/STANDARDS.md` |
| 加载语言标准的方法 | `harness/skills/<language>-load-standards/SKILL.md` |
| 修改该语言代码的方法 | `harness/skills/<language>-implement-change/SKILL.md` |
| 语言质量验收 | `harness/checks/<language>-quality-gate/CHECK.md`，例如执行 `go test`、`go vet` 或 Node.js 项目质量门禁 |
| 公司内部标准 | 独立的 `harness/workflows/<company>-<language>-standards/`，只维护公司增量规则，不复制通用语言标准 |
| 公司扩展执行方法 | 只有存在真实公司 CLI、模板或规范时，新增对应 `<company>-*` Skill |
| 公司扩展结果验收 | 只有存在稳定验收规则时，新增对应 `<company>-*` Check |
| 开发步骤和返工路径 | `harness/workflows/<language>-<project>-development/workflow.yaml` |
| 稳定输入输出结构 | `harness/models/*.schema.json` |

修改类入口 Workflow 的前置顺序应保持为：

```text
common-change-execution-policy
  → <language>-standards
  → <company>-<language>-standards（如适用）
  → <language>-<project>-development
```

其中，通用执行协议、语言标准和公司标准只通过前置 Workflow 组合；业务入口 Workflow 只声明路由、Step 和 Transition。真实的公司扩展执行放在 Skill，确定性验证放在 Check，输入输出字段放在 Model，不能把这些规则写成 Workflow 中的自由文本或重复复制到多个 Skill。

## 项目本地安装

`install` 将发布载荷原子安装到业务项目的 `harness-graph/`。Project Root 与默认 Workspace Root 是业务项目根，Harness Root 是 `<project>/harness-graph`，Runtime Root 是 `<harness>/runtime`，State Root 是 `<harness>/.state`。`installation.json` 保存布局、版本和 Runtime 内容哈希，不保存机器绝对路径。

npm 包 `@jichaowang/harness-graph` 是 Bootstrap 发布边界。发布白名单只包含编译后的 `dist/`、Workflow、Model、Check、Skill、Catalog、激活声明和用户文档。npm 不发布根 `package-lock.json`；安装器从公开包的 `package.json` 投影出 `private: true` 的 Runtime Package，并在目标项目现场生成生产 Lockfile。源码安装与 npm 安装使用同一套 `installHarnessProject()` Interface。

安装 Module 通过 `installHarnessProject()`、`checkHarnessProject()` 和 `resolveHarnessPaths()` 三个 Interface 隐藏载荷复制、Runtime 生产依赖恢复、托管块校验、项目 Skill Adapter、幂等规则、Catalog 激活和 Root 推导。安装器先在 Project Root 内创建临时目录，完成 Runtime、资产、启动器、清单和 Catalog 后再移动到 `harness-graph/`。

`AGENTS.md`、`CLAUDE.md` 和 `.gitignore` 仍归业务项目所有。安装器只替换唯一的版本化托管块；缺失半边、重复标记、目录或不可读写文件都会使安装失败，不猜测、不合并。

Codex 与 Claude Code 分别通过 `.agents/skills/harness-graph/SKILL.md` 和 `.claude/skills/harness-graph/SKILL.md` 发现项目入口。两个安装器管理的 Adapter 内容相同，只加载 `harness-graph/skills/harness-graph/SKILL.md`；规范入口再进入 `workflow-router`。Workflow、Transition 和 Step Skill 的事实源仍全部位于 Harness Root，Adapter 不复制规则，也不能直接执行内部 Step Skill。

项目名称、Harness Root、CLI 和项目 Skill 从 `harness-next` 切换为 `harness-graph` 后，安装清单使用 `layoutVersion: 2`。同一个 `install` Interface 负责首次安装、当前布局幂等升级，以及旧 `layoutVersion: 1` 安装迁移，不增加第二个升级命令。

旧布局迁移只存在于 `src/installation/`：安装器先验证旧清单、Runtime 哈希、托管块和宿主 Adapter，运行中的 Run 或新旧 Root 并存会阻断迁移；随后在 Project Root 的临时目录中复制并转换用户维护的发布资产、重建 Runtime 和 Catalog。新布局通过 preflight 后才切换托管入口并移除旧 Root，失败时保留原安装。Compiler、Router、Runtime 和 Workflow 只认识当前布局，不包含旧品牌分支。

## 模块结构

```text
workflow.yaml ──► compileWorkflow() ──► 标准校验、静态图、Mermaid
      │
      ├──► workflow:sync（全量）────────────────┐
      └──► workflow-activation.yaml ──► workflow:activate（指定入口及依赖） ──┴──► workflow-catalog.json ──► workflow-router Skill
      │
      └──► Local Workflow Runtime
                    ├── start(workflow, executionKey, input)
                    ├── continue(runId, optionalResult)
                    └── cancel(runId, reason)
                              │
                              ▼
                    harness-graph/.state/runs/<run-id>/state.json
```

`compileWorkflow()` 是静态编译 Interface。Runtime 使用 `start / continue / cancel` 作为小 Interface，调用方不需要理解 YAML 解析、Transition、状态文件、执行 trace、Hash、Revision 和 Cycle 计数。`report` 只读取已保存的 Run trace 生成摘要，不成为第二份流程事实源。

`workflow:sync` 扫描全部 Workflow，并以全量模式覆盖 Catalog。`workflow:activate` 读取人工维护的 `harness/workflow-activation.yaml`，仅将声明的入口 Workflow 和递归前置依赖写入同一份 Catalog。Catalog 的 `entryWorkflows` 是 Router 的唯一候选范围；其余保留项只用于解析依赖。

`common-change-execution-policy` 是所有修改类入口共享的非入口前置 Workflow。它通过单个 Skill 加载跨语言执行协议；Node.js、Rust、Go 等语言 Standards 作为并列前置依赖。Catalog 负责校验依赖存在和无环，Router 负责递归去重、顺序执行和恢复时重载上下文。

通用计划和 Review Check 可以与领域 Check 组合在同一 Step。通用 Check 检查计划、范围和证据，领域 Check 只检查 Profile、工具链或语言规则；二者仍返回同一套标准状态，不引入新的结果模型。

计划是目标 Workspace 中的开发文档，不是第六个流程概念，也不是 Runtime 的结构化状态。非平凡任务的分析 Step 在展示计划后将其保存到业务项目既有位置；没有约定时使用 `docs/plans/YYYY-MM-DD-<slug>.md`。Step Result 只在现有 `evidence` 中记录 `planPath=<相对 Workspace Root 的路径>`，后续 Skill 和 Check 按路径读取，因此计划可以由 Git 审阅并跨宿主重启恢复，同时避免在状态文件复制正文。

“接口与文档影响”属于计划和 Review 的横切策略。机器可校验定义是 Interface 的事实源，面向使用者的 Markdown 只维护用法、示例、兼容和迁移说明。业务项目现有约定优先；共享策略只提供无约定时的 HTTP、事件、gRPC、CLI 和 Harness Workflow 默认位置。语言或领域 Skill 负责补充该生态的具体事实源，不复制通用的计划、范围和 Review 规则。

Mermaid 和 SVG Renderer 使用同一个 `FlatGraph`。SVG 使用 Dagre 在本地完成布局，不依赖浏览器或远程渲染服务。

`src/node-project/` 是 Node.js 工程检查的深 Module。它通过 `detectPackageManager(rootDir)` 和 `checkNodeProject()` 两个小 Interface 隐藏根 Lockfile 识别、Node.js 版本一致性、工程基线检查和 npm、Yarn、pnpm 命令差异。Workflow 和 Check 不复制这些规则。

Runtime 区分 Project、Harness、Runtime、State 和 Workspace Root。Harness Root 保存 Workflow、Skill、Check、Model 和 Catalog；State Root 保存 Run 和锁；Workspace Root 是本次 Run 固化的目标项目目录。Check 命令通过 `cwd: harness | workspace` 明确执行位置，前者指向 `harness-graph/`，后者指向业务项目根。引擎仓库开发时保留原目录兼容层和 `.harness/` 状态目录。

## 校验顺序

1. 解析 YAML 或 JSON。
2. 使用 SDK 校验 Open Workflow `1.0.3` 结构。
3. 拒绝 `schedule` 和远程调用 Task。
4. 校验自定义 `call` 对应的 Skill 是否存在。
5. 校验已声明的 Check 是否存在。
6. Skill Step 进入 `switch` 时，校验它是否至少绑定一个 Check。
7. 构建有向图。
8. 检查不可达 Step。
9. 从结束节点反向检查每条执行路径是否可以结束。

Cycle 是合法结构。只有整个 Cycle 没有任何结束路径时才报错。

Runtime 只支持 `.status == "passed|needs_changes|blocked"` 条件。其他表达式在静态校验阶段拒绝，不在运行时执行任意表达式。

## 数据结构

Workflow 和 Step 的业务输入输出都是可选的。需要稳定结构校验时遵循 Open Workflow 的 `input.schema`、`output.schema`。项目内外部 Schema 使用 `harness://models/` URI，安装后固定解析到 Harness Root 的 `models/`。

这种 URI 不包含机器绝对路径，不访问网络，也不能逃逸到 `harness/models/` 之外。Schema 的 `$ref` 可以引用其他 `harness://models/` 资源或当前文档片段，其他外部 URI 会被拒绝。

## Step 执行契约

固定流转的 Skill Step 可以没有业务输入输出和 Check。Skill 正常完成后视为 `passed`，执行 Agent 必须保留可核对证据。

需要质量判断或条件分支时配置 Check。Check 统一返回：

```yaml
status: passed | needs_changes | blocked
evidence:
  - 可核对的依据
data: {} # 可选业务数据
```

`switch` 只读取这种明确结果，不解析自由文本来猜测下一步。

确定性 Check 可以在 `CHECK.md` Front Matter 声明 `command`、`args` 和可选 `cwd: harness | workspace`。Runtime 使用 `shell: false` 执行，状态只保存退出码、耗时和输出 Digest。主观 Check 仍由 Agent 判断并提供证据。

## 本地运行状态

- `executionKey` 标识同一个宿主任务；重复 `start` 返回已有 Run。
- 一个 Worktree 同时只允许一个 `running` Run。
- Runtime 返回 Step 前已经把它记录为 `in_progress`。
- 重复启动或无结果调用 `continue` 返回 `interrupted`，Router 必须先核对工作区，不能直接重做。
- 当前 Step 缺少可由用户补充的决定时，Router 不写 Step Result，也不调用 `continue`；它保持 Step 为 `in_progress` 并询问，回答后复用相同 Run。只有无法通过回答继续时才提交 `blocked`。
- Step Result 必须匹配 `runId`、`revision` 和当前 `stepId`。
- Run 固定 Workflow Version 和 Source Hash，Workflow 改变后拒绝继续。
- Run 固化 Workspace Root，恢复时不能切换目标项目目录。
- Step 超过 `maxStepAttempts` 后进入 `blocked`。
- 到达结束节点时使用 Workflow Output Schema 校验 `data`。

状态使用临时文件加重命名原子写入 `harness-graph/.state/runs/`。第一版不提供宿主生命周期 Hook，也不实现多个 Agent 在同一业务项目并发执行。

## 当前执行范围

首版支持：

- 自定义 `call`；
- `switch`；
- 声明顺序；
- `then` 跳转和回改 Cycle；
- Workflow 输入输出 JSON Schema 校验。
- Workflow Catalog 和 Router 入口；
- 本地 Run 状态、幂等恢复和中断检测；
- 确定性 Check 命令；
- `start / continue / cancel` Runtime。
- 本地目标 Workspace 中 Node.js TypeScript 项目的 npm、Yarn、pnpm 自适应质量门禁。

首版不支持：

- `schedule`；
- HTTP、gRPC、OpenAPI、AsyncAPI、MCP、A2A；
- `listen`、`emit` 等事件 Task；
- `for`、`fork`、`try` 的本地执行；
- 外部 Agent 调用；
- Codex、Claude Code 等宿主生命周期 Hook；
- 多 Agent 并发、Scheduler、Queue 和远程执行；
- 除状态比较外的运行时表达式求值。

只有出现明确本地使用场景、执行语义和测试后，才扩大允许的标准 Task 子集。

## Golden 回归边界

P0 Golden 只锁定核心执行语义：Workflow Compiler 产生的 Step、Check 和 Transition，以及 Runtime 的回改 Cycle、Check 和完成 Trace。时间戳和耗时会被规范化。安装器与 npm 发布物变化更频繁，使用针对不变量的显式断言和真实安装 smoke test，避免把目录清单固化为高维护成本的快照。

`harness/generated/workflow-catalog.json` 本身已经是由 Workflow 生成并提交的可审阅产物，`workflow:activate --check` 负责检测漂移，因此不再建立第二份 Catalog Golden。Golden 只能通过显式 `UPDATE_GOLDEN=1` 在本地更新，CI 永远只读比较。

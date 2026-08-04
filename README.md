# Harness Next

Harness Next 使用一份标准 `workflow.yaml` 描述本地 Agent 应按什么顺序加载 Skill、执行任务，并在需要判断时接受 Check。项目采用 [Open Workflow Specification](https://github.com/open-workflow-specification/specification) 作为唯一 Workflow 格式。

## 快速开始

### 1. 构建 Bootstrap CLI

当前版本从 Harness Next 源码构建安装命令，需要 Node.js 22 或更高版本：

```bash
cd /path/to/harness-next
npm ci
npm run build
```

### 2. 安装到业务项目

在业务项目根目录执行 `install`：

```bash
cd /path/to/your-project
node /path/to/harness-next/dist/cli.js install
```

也可以从 Harness Next 仓库直接指定目标目录：

```bash
node dist/cli.js install /path/to/your-project
```

安装器会创建 `harness-next/`，并在 `AGENTS.md`、`CLAUDE.md` 和 `.gitignore` 顶部维护版本化入口块。它还会创建 `.agents/skills/harness-next/SKILL.md` 和 `.claude/skills/harness-next/SKILL.md`，供 Codex 和 Claude Code 发现项目入口。项目原有规则保持不变。

Runtime、Workflow、Model、Check 和 Skill 会随业务项目保存。运行状态位于 `harness-next/.state/`，Runtime 依赖位于 `harness-next/runtime/node_modules/`，两者都被 Git 忽略。

### 3. 验证安装

安装完成后只使用项目本地入口：

```bash
./harness-next/bin/harness-next preflight
./harness-next/bin/harness-next route
```

`preflight` 检查 Runtime、安装清单、Catalog、托管入口和状态目录。`route` 会先执行同样的检查，再返回当前 Agent 应加载的 Router Skill。

以上相对命令在业务项目根目录执行。启动器不依赖安装时的绝对路径；移动整个项目后仍能从自身位置解析 Runtime。

项目 clone 到新机器后，先根据安装目录中的 Lockfile 恢复 Runtime 生产依赖，再执行 `preflight`：

```bash
npm ci --prefix harness-next/runtime --omit=dev --ignore-scripts --no-audit --no-fund
./harness-next/bin/harness-next preflight
```

再次从 Harness Next 源码执行 `install` 会检查并升级项目本地 Runtime；首次安装和升级都会生成只包含生产依赖的 Runtime `package.json` 与 Lockfile。若项目存在运行中的 Run，升级会停止并保留原 Runtime，待 Run 完成或取消后再重试 `install`。

### 4. 让 Agent 执行任务

日常使用时，在业务项目中直接向 Agent 描述任务。托管入口要求 Agent 先运行 `route`，也可以在提示中明确写出：

```text
先执行 ./harness-next/bin/harness-next route，
然后使用 node-typescript-development 工作流修复配置加载失败，并补充回归测试。
```

Agent 会根据 Catalog 选择 Workflow，并通过项目本地 CLI 创建或恢复 Run。每次只加载当前 Step 的 Skill、Check 和必要输入，Transition 由 Runtime 返回。

需要显式触发项目 Skill 时，Codex 使用 `$harness-next`，Claude Code 使用 `/harness-next`：

```text
$harness-next 使用 node-typescript-development 工作流修复配置加载失败，并补充回归测试
/harness-next 使用 node-typescript-development 工作流修复配置加载失败，并补充回归测试
```

用户明确给出的 Workflow 名称或 Alias 会作为强制选择；名称不存在、有歧义或不是入口 Workflow 时会停止并报告。两个宿主 Adapter 只转交给 `harness-next/skills/harness-next/SKILL.md`，再由它加载 `workflow-router`。不要直接调用 `harness-next/skills/` 中的内部 Step Skill。

宿主或 Agent 重启后，重新执行 `route` 即可检查可恢复 Run。不要删除 `harness-next/.state/`，也不要手工解析 Workflow 决定下一步。

### 5. 修改项目本地 Workflow

业务项目可以直接维护安装后的 Workflow、Skill、Check 和 Model。修改已激活 Workflow 或激活声明后，刷新并检查 Catalog：

```bash
./harness-next/bin/harness-next activate
./harness-next/bin/harness-next activate --check
./harness-next/bin/harness-next validate workflows/node-typescript-development/workflow.yaml
```

重复执行 `install` 不会覆盖项目修改或删除的 Workflow、Skill、Check 和 Model。早期 `layoutVersion: 1` 安装如果尚未包含项目级 Skill，同一个 `install` 会原地补充规范入口、两个宿主 Adapter、Runtime 和清单字段，不需要额外迁移命令。Runtime 必需文件缺失时安装会失败；当前版本不提供 `repair` 或卸载命令。

### 6. 失败处理

`preflight`、Catalog 检查或 Runtime 返回 `blocked`、`failed`、`cancelled` 时应停止并报告，不得绕过项目本地入口继续执行。

`.state/` 中不得保存 Secret 或完整 Prompt。需要查看底层 Runtime 命令时，参考后文“Runtime 调试”；日常任务不需要手工调用 `start`、`continue` 或 `cancel`。

## 全局怎么工作

```mermaid
flowchart TD
    A["多个 workflow.yaml"] --> B["workflow:sync（全量）"]
    D["workflow-activation.yaml"] --> E["workflow:activate（指定入口及依赖）"]
    B --> C["Workflow Catalog"]
    E --> C
    C --> D["workflow-router Skill"]
    D --> E["start 创建或恢复 Run"]
    E --> F["返回当前 Step Skill 和 Check"]
    F --> G["Agent 只执行当前 Step"]
    G --> H["continue 提交结构化结果"]
    H --> I{"Runtime 状态"}
    I -->|下一 Step| F
    I -->|blocked| J["停止并报告"]
    I -->|completed| K["校验输出并交付"]
```

贡献者只维护四类内容：

| 路径 | 内容 |
| --- | --- |
| `harness/workflows/` | Workflow、Step 和 Transition |
| `harness/models/` | 输入输出的 JSON Schema |
| `skills/` | Agent 完成 Step 的方法 |
| `harness/checks/` | Step 的验收规则 |

这些是 Harness Next 引擎仓库中的发布源路径；安装到业务项目后分别位于 `harness-next/workflows/`、`harness-next/models/`、`harness-next/checks/` 和 `harness-next/skills/`。项目根目录的 `.agents/skills/harness-next/` 与 `.claude/skills/harness-next/` 只是宿主 Adapter，不是第二份 Skill 事实源。

## 五个核心关键词

| 项目关键词 | Open Workflow 写法 | 含义 |
| --- | --- | --- |
| `Workflow` | 整个文档 | 完整流程 |
| `Step` | `do` 中的具名 Task | 一个执行或判断步骤 |
| `Transition` | 声明顺序、`then`、`switch` | 如何进入下一个 Step |
| `Skill` | 自定义 `call` | Agent 完成当前 Step 的方法 |
| `Check` | `metadata.harness.checks` | 需要质量判断或分支时使用的验收规则 |

业务输入和输出都是可选数据，不增加新的流程概念。

## Step 如何继续

- 固定顺序的 Skill Step 可以没有 `input`、`output` 和 Check；Skill 正常完成后视为 `passed`。
- Skill Step 下一节点是 `switch` 时必须绑定 Check，由 Check 提供明确状态。
- `passed` 继续，`needs_changes` 进入声明的回改 Step，`blocked` 停止并等待处理。
- 每次结果都应包含可核对的 `evidence`，业务 `data` 可选。

```yaml
status: passed | needs_changes | blocked
evidence:
  - 执行或判断依据
data: {}
```

## 当前支持范围

已经实现：

- YAML 和 JSON Workflow 解析；
- Open Workflow Specification `1.0.3` 标准校验；
- Workflow 输入输出 JSON Schema 校验；
- 无显式业务输入输出的 Skill Playbook；
- 顺序执行、`switch` 条件分支和通过 `then` 表达的回改 Cycle；
- Mermaid 流程图生成；
- 本地 SVG 图片生成；
- 不存在的 Skill、Check 和 Transition 检查；
- 不可达 Step 和无法到达结束节点的路径检查。
- 从 Workflow 元数据生成路由 Catalog；
- 本地 `start / continue / cancel` Runtime；
- `executionKey` 幂等恢复和单 Worktree 活动 Run 限制；
- Workflow Version、Source Hash 和 Step Revision 校验；
- Cycle 最大尝试次数；
- Check 结构化命令的本地执行和 Digest 证据；
- Run 完成时的 Workflow Output Schema 校验。
- npm、Yarn、pnpm 自动识别和 Node.js TypeScript 工程质量门禁；
- 工作区内 JSON Schema 通过 `harness://models/` 相互引用。

首版只接受两类 Task：

- 自定义 `call`：映射到本地 `skills/<call>/SKILL.md`；
- `switch`：只负责流程分支。

`schedule`、HTTP、gRPC、MCP、A2A、事件任务和其他远程执行能力会被拒绝。`for`、`fork`、`try` 等标准结构等本地执行语义明确后再开放。

Runtime 不调用外部 Agent，也不提供分布式调度。`workflow-router` 由当前本地 Agent 加载，并自动调用 Runtime、加载当前 Skill 和提交结果。

第一版提供 Codex 和 Claude Code 的项目 Skill Adapter，但没有宿主生命周期 Hook。Agent 或宿主完全重启后不保证主动恢复；重新触发项目 Skill 或加载 Router 后，Runtime 可以根据本地状态安全恢复。

## Agent 使用

安装后的项目任务只需要执行唯一入口：

```text
./harness-next/bin/harness-next route
```

命令先执行 preflight，再返回项目本地 Router Skill。Router 只读取 `harness-next/generated/workflow-catalog.json` 的 `entryWorkflows`，并通过项目本地 CLI 执行 `start`、`continue` 和必要的 `cancel`。用户不需要逐条运行内部命令。

### 使用 Node.js TypeScript 工作流

Node.js TypeScript 工作流适用于新增或修改功能、修复缺陷和重构代码。只解释代码或只做 Review 时不会选择该 Workflow。

在已安装 Harness Next 的项目中，直接描述需要完成的变更：

```text
先执行 ./harness-next/bin/harness-next route，
再使用 node-typescript-development 工作流修复配置加载失败，并补充回归测试。
```

也可以使用 Alias `nodejs-development` 或 `typescript-development`。没有明确指定名称时，Router 会根据请求内容和 Catalog 中的适用、排除场景选择 Workflow；无法得到唯一候选时会停止并报告，不会自行猜测。

Router 选中 `harness-next/workflows/node-typescript-development/workflow.yaml` 后，会先完成其前置的 `node-typescript-standards` Workflow。该 Workflow 只有一个节点，负责将完整规范加载到当前 Agent 上下文；随后才进入开发流程：

| 阶段 | 执行内容 | 未通过时 |
| --- | --- | --- |
| 分析 | 阅读相关代码、约束和测试，明确目标、范围、风险及验证方式，不修改代码 | 分析信息不足时重新分析；缺少用户决定、权限或外部条件时停止 |
| 实现 | 按已通过的分析范围修改代码；行为变化先补失败测试，再完成最小实现 | 进入后续质量门禁 |
| 质量门禁 | 执行项目 Typecheck、Lint、Test、Build、变更文件规范检查和 `git diff --check` | 任一命令失败都会返回实现阶段修复 |
| Review | 基于需求、实际 Diff、测试和命令证据检查正确性、回归、兼容性与范围 | 发现可修复问题时返回实现阶段 |
| 交付 | 汇总变更、验证证据和剩余风险 | 输出不满足 Schema 时不会完成 Run |

每个 Step 最多尝试 3 次。执行过程中，Agent 每次只加载当前 Step 的 Skill、Check 和必要输入，Transition 完全由 Runtime 返回，用户不需要手工执行 `workflow:start` 或 `workflow:continue`。

Workflow 完成后输出以下结构：

```yaml
status: done
summary: 本次变更摘要
changedFiles:
  - src/example.ts
verification:
  - npm test 通过
risks: []
```

一个 Worktree 同时只能有一个 `running` Run。Agent 或宿主重启后，重新执行 `route` 可以使用相同的 `executionKey` 恢复；如果 Runtime 返回 `interrupted`，Router 会先核对工作区和已有证据，再决定继续、返工或阻塞。

项目初始化和工程配置使用：

```text
harness-next/workflows/node-project-configuration/workflow.yaml
```

它用于初始化新的 Node.js TypeScript 项目，或规范化已有项目的 Node.js 版本、包管理器、Lockfile、TypeScript、ESLint、测试、构建、README 和 CI。业务功能开发仍由 `node-typescript-development` 处理。

Workflow 自动读取 `package.json#packageManager` 和项目根目录 Lockfile。新项目默认 npm；已有项目保留 npm、Yarn 或 pnpm。多个 Lockfile、声明冲突或无法判断时进入 `blocked`，不会自动删除文件或迁移包管理器。

Workflow Input 使用 `projectRoot` 指定目标项目目录，默认 `.`。Harness 的 Workflow、Skill、Check 和 Run 状态仍从 Harness 根目录加载；目标可以是另一个本地空目录或已有项目，但不能是远程仓库或远程执行目标。

## 本地开发

要求 Node.js 22 及以上版本。

```bash
npm install
npm run project:check
npm run check:all
npm run build
npm run doctor
npm run workflow:activate
npm run workflow:sync
npm run workflow:validate -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:validate -- harness/workflows/node-project-configuration/workflow.yaml
npm run workflow:diagram -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-standards/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml --expand-prerequisites
npm run workflow:image -- harness/workflows/node-project-configuration/workflow.yaml
```

可运行示例包括 [node-typescript-standards/workflow.yaml](./harness/workflows/node-typescript-standards/workflow.yaml)、[node-typescript-development/workflow.yaml](./harness/workflows/node-typescript-development/workflow.yaml) 和 [node-project-configuration/workflow.yaml](./harness/workflows/node-project-configuration/workflow.yaml)。

## Workflow 激活范围

[workflow-activation.yaml](./harness/workflow-activation.yaml) 是人工维护的 Router 入口声明。每一项是相对 Harness Root 的入口 `workflow.yaml` 路径：

```yaml
version: 1
entryWorkflowPaths:
  - workflows/node-typescript-development/workflow.yaml
  - workflows/node-project-configuration/workflow.yaml
```

执行以下命令会读取该文件，将声明入口和它们的递归前置依赖写入同一份 `harness/generated/workflow-catalog.json`：

```bash
npm run workflow:activate
```

前置 Workflow 会保留在 Catalog 中供执行期解析，但不是 Router 候选入口。`npm run workflow:sync` 仍可由全部 Workflow 覆盖生成同一个 Catalog；最后执行的命令决定当前 Router 的候选范围。

## Node.js 项目质量门禁

`project-check` 是包管理器无关的本地检查入口：

```bash
npm run project:check
```

也可以从 Harness 根目录直接检查另一个本地项目：

```bash
npm run project:check -- ../path/to/project
```

它先检查 `packageManager`、唯一 Lockfile、`tsconfig.json`、ESLint、README、`.gitignore`、CI、Node.js 版本和标准 scripts，再使用识别出的 npm、Yarn 或 pnpm 依次执行 `typecheck`、`lint`、`test` 和 `build`。完整命令输出不会写入 Run 状态，Runtime 只保存退出码、耗时和 Digest。

引擎仓库中的 `harness/workflows/node-typescript-standards/STANDARDS.md` 会安装为 `harness-next/workflows/node-typescript-standards/STANDARDS.md`。它是 Node.js TypeScript 开发规范的唯一来源，包含模型读取的开发约束，以及质量门禁读取的结构化阈值。质量门禁只检查本次变更的生产 TypeScript 文件，避免历史技术债阻断无关改动；改动任一生产文件后，该文件必须符合全部阈值。

项目配置请求示例：

```json
{
  "request": "初始化一个 Node.js TypeScript CLI 项目",
  "projectRoot": "../my-cli",
  "constraints": []
}
```

## Runtime 调试

安装后的 Router 使用：

```bash
./harness-next/bin/harness-next start <workflow.yaml> <execution-key> <input.json>
./harness-next/bin/harness-next continue <run-id> [step-result.json]
./harness-next/bin/harness-next cancel <run-id> <reason>
./harness-next/bin/harness-next report <run-id> --format markdown
```

Runtime 会把实际执行的 Step、Transition、Check 和证据摘要保存在对应 Run 的 `.state/runs/<run-id>/state.json` 中；`report` 读取这份记录生成摘要，不重新解析 Workflow 来猜测执行路径。执行状态和 trace 属于本地状态，不提交 Git，也不保存完整 Prompt 或 Secret。

下面的 npm scripts 仅供 Harness Next 引擎仓库开发调试使用：

```bash
npm run workflow:start -- <workflow.yaml> <execution-key> <input.json>
npm run workflow:continue -- <run-id> [step-result.json]
npm run workflow:cancel -- <run-id> <reason>
```

命令 stdout 输出 JSON。安装项目使用 `harness-next/.state/runs/<run-id>/state.json`；引擎仓库兼容布局继续使用 `.harness/runs/`。两者都不得写入 Secret 和完整 Prompt。

## 生成图片

`workflow:image` 根据 Workflow 编译得到的同一份有向图生成本地 SVG，不需要浏览器、远程服务或图片上传。

```bash
npm run workflow:image -- harness/workflows/node-typescript-standards/workflow.yaml
```

默认输出：

```text
harness/generated/node-typescript-standards.svg
```

也可以指定当前工作区内的输出路径：

```bash
npm run workflow:image -- harness/workflows/node-typescript-standards/workflow.yaml docs/node-typescript-standards.svg
```

Mermaid 和 SVG 都是展示结果，唯一事实源仍然是 `workflow.yaml`。

当 Workflow 声明 `metadata.harness.prerequisites` 时，可添加 `--expand-prerequisites` 展开其全部前置 Workflow 和 `prerequisite` 依赖边：

```bash
npm run workflow:diagram -- harness/workflows/node-typescript-development/workflow.yaml --expand-prerequisites
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml --expand-prerequisites
```

展开图片默认输出为 `harness/generated/node-typescript-development-expanded.svg`；指定输出路径时，标志可位于路径前后。

## 依赖说明

项目精确锁定 `@openworkflowspec/sdk@1.0.3-alpha4`。该版本目前仍为 `alpha`，所有 SDK 调用都收口在 `compileWorkflow()` 后面，后续升级不应影响 Workflow 贡献者。

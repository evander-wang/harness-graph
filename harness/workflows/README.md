# Workflow

每个 Workflow 使用一个独立目录：

```text
harness/workflows/<workflow-name>/workflow.yaml
```

`workflow.yaml` 必须符合 Open Workflow Specification `1.0.3`，它是流程的唯一事实源。

首版使用：

- `do` 声明 Step；
- 自定义 `call` 绑定本地 Skill；
- `metadata.harness.checks` 按需绑定 Check；
- 声明顺序、`then` 和 `switch` 表达 Transition。

固定流转的 Skill Step 可以没有业务输入输出和 Check。Skill Step 进入 `switch` 前必须绑定 Check，避免根据自由文本猜测分支。

需要 Router 自动选择的 Workflow 在 `document.metadata.harness.routing` 声明：

```yaml
metadata:
  harness:
    routing:
      aliases: [typescript-development]
      when: [修改 Node.js TypeScript 功能]
      notWhen: [只解释代码而不修改]
    execution:
      maxStepAttempts: 3
```

`harness/workflow-activation.yaml` 由人维护当前 Router 的入口 Workflow 路径。新增或修改已激活的 Workflow 后执行 `npm run workflow:activate`；它会把入口及其前置依赖写入 Catalog。`npm run workflow:sync` 仅用于由全部 Workflow 覆盖生成全量 Catalog。Catalog 只用于路由，禁止手工编辑。

## 修改类 Workflow 组合

会修改代码、配置或其他项目文件的入口 Workflow 必须组合通用执行协议，并按需组合语言或领域 Standards：

```yaml
metadata:
  harness:
    prerequisites:
      - common-change-execution-policy
      - node-typescript-standards
```

`common-change-execution-policy` 是非入口前置 Workflow，负责加载跨语言修改协议；语言 Standards 只维护该语言的开发规范。入口 Workflow 负责路由和 Transition，不复制两类前置规则。

参考：

- `common-change-execution-policy/workflow.yaml`：所有修改类 Workflow 共享的执行协议；
- `node-typescript-standards/workflow.yaml`：Node.js TypeScript 开发的单节点前置规范加载流程；
- `node-typescript-development/workflow.yaml`：已有工程中的业务代码变更；
- `node-typescript-project-configuration/workflow.yaml`：初始化或规范化当前 Node.js TypeScript 项目。

项目配置 Workflow 自动判断新项目或已有项目，但不为两者维护两套流程。Input 的 `projectRoot` 指定本地目标目录并由 Runtime 固化；包管理器冲突需要返回 `blocked`，禁止自动删除 Lockfile。

流程图由 CLI 从 Workflow 生成，禁止维护第二份手工流程图。

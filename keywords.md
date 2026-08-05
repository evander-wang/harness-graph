# Harness Graph 关键词

项目只要求贡献者理解五个核心关键词。

Workflow Catalog、Router、Runtime 和 Run 是工具内部实现，不是新的流程建模概念。贡献者设计流程时仍然只使用下面五个关键词。

## Workflow

一个完整流程，对应一个标准 `workflow.yaml`：

```text
Workflow
├── document
├── input（可选）
├── do
└── output（可选）
```

`document.dsl` 是 Open Workflow DSL 版本，`document.version` 是当前业务流程版本。

## Step

`do` 中的每个具名 Task 都是一个 Step：

```yaml
do:
  - load-node-typescript-standards:
      call: load-node-typescript-standards
```

首版 Step 只有两种形式：

- 自定义 `call`：执行本地 Skill；
- `switch`：根据当前数据选择后续 Step。

## Transition

Step 之间的连接方式：

- 没有 `then` 时，进入声明列表中的下一个 Step；
- `then: <step-id>` 时，进入指定 Step；
- `then: end` 时，结束 Workflow；
- `switch` 根据条件选择不同的 `then`。

回到前面的 Step 就形成 Cycle。Cycle 必须至少存在一条可以到达结束节点的路径。

## Skill

自定义 `call` 的值就是 Skill ID：

```yaml
call: load-node-typescript-standards
```

它固定解析到：

```text
skills/load-node-typescript-standards/SKILL.md
```

这是引擎仓库的发布源路径；安装后物理路径是 `harness-graph/skills/load-node-typescript-standards/SKILL.md`。

Skill 只完成当前 Step，不决定后续流程。

## Check

Check 是可选的验收规则。固定流转的 Skill Step 可以没有 Check；只有 Skill Step 进入 `switch`、需要依据结果分支时，才必须绑定 Check：

```yaml
metadata:
  harness:
    checks:
      - change-review-result
```

它固定解析到：

```text
harness/checks/change-review-result/CHECK.md
```

安装后物理路径是 `harness-graph/checks/change-review-result/CHECK.md`。

Check 必须输出明确状态和可核对证据：

```yaml
status: passed | needs_changes | blocked
evidence:
  - 可核对的依据
data: {} # 可选
```

没有 Check 时，Skill 正常执行完成即视为 `passed`，并由执行 Agent 记录证据。

## 输入和输出

Workflow 和 Step 的业务输入输出都是可选的。需要稳定结构校验时使用 JSON Schema，项目内 Schema 使用可移植 URI：

```yaml
input:
  schema:
    resource:
      endpoint: harness://models/node-change-request.schema.json
```

在引擎仓库中该 URI 解析到 `harness/models/node-change-request.schema.json`，安装后解析到 `harness-graph/models/node-change-request.schema.json`，不会访问网络。

## 命名规范

| 对象 | 格式 | 示例 |
| --- | --- | --- |
| Workflow、Step、Skill、Check ID | `kebab-case` | `change-review-result` |
| JSON 字段名 | `lowerCamelCase` | `maxAttempts` |
| Check 状态 | `snake_case` | `needs_changes` |

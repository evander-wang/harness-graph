# Check

每个 Check 使用独立目录：

```text
harness/checks/<check-id>/CHECK.md
```

Workflow 使用 `metadata.harness.checks` 按 Check ID 引用。固定流转的 Skill Step 可以没有 Check；Skill Step 进入 `switch` 前必须绑定至少一个 Check。

Check 必须说明检查对象、通过条件、失败条件，并返回统一格式：

```yaml
status: passed | needs_changes | blocked
evidence:
  - 可核对的依据
data: {} # 可选业务数据
```

能够稳定程序化判断的规则优先写成代码测试。需要 Agent 判断的 Check 不能只给出模糊结论。

## 通用与领域 Check

同一 Step 可以组合多个 Check。`common-change-plan-ready` 和 `common-change-review-result` 维护跨语言的计划、范围和证据要求；领域 Check 只维护项目类型或语言特有规则。

```yaml
metadata:
  harness:
    checks:
      - common-change-plan-ready
      - node-typescript-project-plan-ready
```

禁止在领域 Check 中复制通用规则。Agent 必须同时满足当前 Step 返回的全部 Check，Runtime 仍只接受一个结构化 Step Result。

## 确定性命令

需要 Runtime 执行命令时，在 `CHECK.md` Front Matter 中使用结构化声明：

```yaml
---
commands:
  - command: node
    args: [runtime/dist/cli.js, project-check]
    cwd: harness
  - command: git
    args: [diff, --check]
    cwd: workspace
---
```

禁止写 `npm run lint && npm test` 等 Shell 字符串。Runtime 使用 `shell: false` 执行，只保存退出码、耗时和输出 Digest。

命令默认在目标 Workspace 执行。需要读取 Harness 自身构建产物时声明 `cwd: harness`；需要检查目标项目 Git 状态时声明 `cwd: workspace`。Runtime 会把固化的目标目录通过 `HARNESS_WORKSPACE_ROOT` 提供给 Harness 命令。

共享 Node.js 质量门禁使用 `project-check`，由它根据 `package.json#packageManager` 和唯一根 Lockfile 选择 npm、Yarn 或 pnpm。Check 不复制三套命令。

# Harness Graph

Harness Graph 为本地编码 Agent 提供可执行的 Workflow。它会根据任务加载对应的开发规范、执行步骤和检查规则，并在需要时暂停等待你的决定。

## 安装

要求 Node.js 22 或更高版本。在业务项目根目录执行：

```bash
npx --yes @jichaowang/harness-graph@latest install
```

安装完成后，项目中会出现 `harness-graph/`，其中保存 Workflow、Skill、Check 和本地 Runtime。安装器也会配置 Codex、Claude Code 等 Agent 的项目入口。

先检查安装：

```bash
./harness-graph/bin/harness-graph preflight
```

升级到新版本时，重新执行对应版本的 `npx` 安装命令即可：

```bash
npx --yes @jichaowang/harness-graph@<version> install
```

## 使用 Agent

在业务项目根目录先执行：

```bash
./harness-graph/bin/harness-graph route
```

然后直接向 Agent 描述任务即可。例如：

```text
修复配置加载失败，并补充回归测试。
```

需要指定流程时，可以明确写出 Workflow：

```text
使用 node-typescript-development Workflow 修复配置加载失败，并补充回归测试。
```

当前常用 Workflow：

- `node-typescript-development`：新增功能、修复缺陷、重构和代码变更。
- `node-typescript-project-configuration`：初始化或规范化 Node.js TypeScript 项目。

Agent 会自动执行前置规范、当前 Step 和 Check。任务遇到需要你决定的问题时会暂停询问，不会擅自继续。

## 打开 Workflow UI

### 已安装到业务项目

在业务项目根目录执行：

```bash
./harness-graph/bin/harness-graph ui
```

默认访问 [http://127.0.0.1:4173](http://127.0.0.1:4173)。指定端口：

```bash
./harness-graph/bin/harness-graph ui 4300
```

### Harness Graph 源码仓库

如果你正在运行本仓库源码，在项目根目录执行：

```bash
npm ci
npm run workflow:ui
```

然后访问 [http://127.0.0.1:4173](http://127.0.0.1:4173)。不要直接双击打开 `web/index.html`，页面需要本地 UI 服务提供 Workflow API。

### UI 操作

- 点击左侧 Workflow 查看流程图。
- 拖动空白处移动画布，拖动节点块移动单个节点。
- 点击节点后，右侧只显示该节点对应的 Workflow、Skill 和 Check 文件。
- 点击文件可在大弹框中查看完整内容。
- `适配` 恢复默认视图，`网格` 显示或隐藏背景网格，`+` 和 `-` 调整缩放。
- 右侧的运行观察区域显示当前 Workflow 的 Run、Step、状态、Check 和证据。

## 常用命令

```bash
# 检查本地安装
./harness-graph/bin/harness-graph preflight

# 获取 Agent 入口指令
./harness-graph/bin/harness-graph route

# 查看某次运行报告
./harness-graph/bin/harness-graph report <run-id> --format markdown
```

运行状态保存在 `harness-graph/.state/`，由本地 Runtime 使用，不要手工删除或修改。

## 获取帮助

如果安装失败，先执行：

```bash
./harness-graph/bin/harness-graph preflight
```

如果 UI 打开后为空，确认访问的是 `http://127.0.0.1:<port>`，而不是 `file://` 页面；然后刷新浏览器。

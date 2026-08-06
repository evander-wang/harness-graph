---
name: review-node-project-configuration
description: 审查 Node.js TypeScript 项目配置的一致性、安全性、范围和可维护性。
---

# 审查 Node.js TypeScript 项目配置

基于用户请求、`NodeProjectProfile`、实际 Diff 和确定性命令证据进行审查。

优先检查：

- 实际项目是否达到 Profile，而不是只创建了配置文件；
- `packageManager`、Lockfile、README、CI 和真实命令是否一致；
- Node.js Major、模块系统、入口和构建产物是否一致；
- Typecheck、Lint、Test、Build 是否各自验证了正确内容；
- 新项目是否可以从 clean install 开始使用；
- 已有项目是否静默迁移或删除了有意功能；
- 是否提交 Secret、真实凭据、本机绝对路径或完整 Prompt；
- 是否把 Docker、数据库、日志等可选能力无需求地塞进项目；
- 文档是否给出准确的安装、开发、检查、构建和启动命令。

发现问题时给出文件、位置、影响和可验证依据。全部满足时返回 `passed`，可修复问题返回 `needs_changes`，需要用户决策或外部条件时返回 `blocked`。

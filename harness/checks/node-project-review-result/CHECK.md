# node-project-review-result

检查实际配置是否满足已通过的 `NodeProjectProfile`。

通过必须同时满足：

- npm、Yarn 或 pnpm 声明与唯一根 Lockfile 一致；
- Node.js Major、scripts、TypeScript、ESLint、测试、构建、README 和 CI 相互一致；
- 新项目具备 clean install 所需的清单和 Lockfile；
- 已有项目没有未经授权的包管理器、模块系统、测试框架或部署迁移；
- 没有新增被 Git 跟踪的 Secret、真实凭据或本机绝对路径；
- 可选能力只在需求或已有结构需要时存在；

领域配置问题返回 `needs_changes`；必须由外部环境处理的问题返回 `blocked`。通用范围、证据和用户询问规则由同一 Step 绑定的 `change-review-result` 负责。

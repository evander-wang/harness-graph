---
name: deliver-node-project-configuration
description: 汇总 Node.js TypeScript 项目配置、验证证据、保留决定和剩余风险。
---

# 交付 Node.js TypeScript 项目配置

根据已完成 Step 和 Runtime 保存的证据生成 `NodeProjectConfigurationResult`。

输出必须包含：

- `status: done`；
- 最终 `NodeProjectProfile`；
- 实际修改文件；
- 确实执行过的验证及结果；
- 为兼容已有项目而保留的决定；
- 仍然存在的环境要求或风险。

不得把未执行的 clean install、CI、测试或构建写成已通过，不得在结果中包含 Secret、完整命令输出或完整 Prompt。

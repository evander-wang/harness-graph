# Node.js TypeScript 新项目基线

本文件固定 `node-project-configuration@0.1.0` 的默认初始化结果。更新工具版本、标准 scripts 或目录结构时必须同步评估 Workflow Version。

## 默认工具版本

```text
Node.js: 24
TypeScript: 5.8.3
tsx: 4.21.0
ESLint: 9.31.0
@eslint/js: 9.31.0
typescript-eslint: 8.38.0
Vitest: 3.2.4
@types/node: 24.0.15
```

使用 npm 安装这些精确版本并生成 Lockfile。`packageManager` 记录实际执行 `npm --version` 的结果，不猜测版本。

```bash
npm install --save-dev --save-exact typescript@5.8.3 tsx@4.21.0 eslint@9.31.0 @eslint/js@9.31.0 typescript-eslint@8.38.0 vitest@3.2.4 @types/node@24.0.15
```

## 默认目录

```text
<project-root>/
├── .github/workflows/ci.yml
├── src/
│   └── index.ts
├── test/
│   └── index.test.ts
├── .gitignore
├── .nvmrc
├── eslint.config.js
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
└── tsconfig.build.json
```

不创建 Docker、数据库、日志和健康检查文件，除非用户需求或 `projectKind` 明确需要。

## package.json

所有项目都必须声明：

```json
{
  "type": "module",
  "packageManager": "npm@<实际 npm 版本>",
  "engines": {
    "node": ">=24.0.0 <25"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "check:all": "npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

- `service` 和 `cli` 默认 `private: true` 并保留 `dev`、`start`。
- `library` 根据用户发布要求决定 `private`，默认不声明 `start`，并在 `tsconfig.build.json` 开启 Declaration；不得擅自配置 npm publish。
- `name`、`description` 和入口语义来自用户请求，不使用无意义占位内容交付。

## tsconfig.json

默认配置必须包含：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "eslint.config.js", "vitest.config.ts"]
}
```

`tsconfig.build.json` 继承根配置，设置 `rootDir: "src"`、`outDir: "dist"`，只包含 `src/**/*.ts`。`library` 增加 `declaration: true`。

只有项目明确使用 Node.js strip-only 执行 TypeScript 时才开启 `erasableSyntaxOnly`，不能把该约束强加给使用编译器转换语法的已有项目。

## ESLint

使用 Flat Config、`@eslint/js` 和 `typescript-eslint` strict type checked 配置，至少启用：

```text
@typescript-eslint/consistent-type-imports: error
@typescript-eslint/no-explicit-any: error
```

忽略 `dist/**` 和 `node_modules/**`。不为了通过 Lint 关闭 strict rule；确有例外时必须在最小位置说明原因。

## CI

GitHub Actions 使用 Node.js 24，顺序固定：

```text
checkout
setup-node 24 with npm cache
npm ci
npm run check:all
```

如果项目使用其他 CI 平台，保留平台并实现相同语义，不额外引入 GitHub Actions。

## 已有项目规范化决策表

| 现状 | 默认处理 |
| --- | --- |
| 只有一个根 Lockfile，没有 `packageManager` | 执行对应管理器的版本命令并补准确声明 |
| 多个根 Lockfile | `blocked`，不自动删除 |
| 声明与 Lockfile 冲突 | `blocked`，要求用户选择事实源 |
| 缺少标准 script，但已有同语义命令 | 增加指向现有命令的 Alias |
| 标准 script 名称与实际语义明显不符 | 保证旧能力仍有正确入口后再修正，并记录兼容性影响 |
| `.nvmrc`、Docker、CI 不一致 | 使用用户约束或已确认的 `.nvmrc` 作为固定版本，统一 Docker 和 CI |
| `engines.node` 不包含固定版本 | 调整支持范围或固定版本，不能只改到门禁通过 |
| 已有 CommonJS、测试框架或构建工具 | 保留，不按新项目默认强制迁移 |
| 配置文件可能包含真实 Secret | 不输出值；停止提交新增 Secret，并报告已有风险 |

## 完成条件

必须从当前项目根目录实际执行：

```text
typecheck
lint
test
build
```

四项都通过、README 命令与实际一致、唯一根 Lockfile 已生成后，才可以进入 Review。

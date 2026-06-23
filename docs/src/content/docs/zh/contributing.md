---
title: 贡献
description: 在本地搭建 PosterPilot 进行开发，并运行每个更改在审查前都必须通过的质量检查。
---

欢迎提交问题和拉取请求。本页总结了本地搭建和
质量检查；权威且始终最新的来源是仓库中的
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md)。

## 本地搭建

PosterPilot 是一个运行在 [Bun](https://bun.sh) 上的 SvelteKit 应用。

```sh
bun install
cp .env.example .env          # 填写 PLEX_URL / PLEX_TOKEN / TMDB_KEY（或使用设置界面）
bun run db:generate           # 从 Drizzle schema 生成 SQL 迁移（已提交）
bun run dev                   # http://localhost:5173
```

迁移会在服务器启动时自动应用。

## 质量检查

每个更改在审查前都必须通过这些检查——CI 运行的也是同样的检查：

```sh
bun run check     # svelte-check 类型检查
bun run test      # vitest 单元测试
bun run lint      # prettier --check（运行 `bun run format` 可自动修复）
```

对于服务器逻辑，项目遵循测试驱动开发——先编写一个失败的
测试，然后再编写实现。保持纯粹、可测试的逻辑不含
`$env` / `$app` 导入，以便它可以被隔离进行单元测试（参见现有
测试中的模式）。

## 提交信息

项目使用 [Conventional Commits](https://www.conventionalcommits.org/)。
类型前缀驱动通过 release-please 进行的自动化变更日志和版本号递增：

- `feat:` — 一个新功能（minor 递增）
- `fix:` — 一个错误修复（patch 递增）
- `docs:`、`chore:`、`refactor:`、`test:`、`ci:` — 单独使用时不触发发布
- `feat!:` / 一个 `BREAKING CHANGE:` 脚注 — major 递增

示例：`feat(library): add genre filter`。

## 拉取请求

1. 从 `main` 分支。
2. 进行聚焦的更改；将差异范围限定在单一关注点上。
3. 确保 `check`、`test` 和 `lint` 都通过。
4. 使用模板打开一个 PR，并关联任何相关的问题。

## 规范驱动的更改

较大的功能会使用
[OpenSpec](https://github.com/Fission-AI/OpenSpec) 在 `openspec/changes/` 下进行规划。对于
重大更改，先提出规范，然后再针对其任务进行实现。能力规范
位于 `openspec/specs/` 下。

## 翻译

帮助翻译界面无需任何编码——参见
[翻译](/posterpilot/zh/translating/) 了解 Weblate 工作流程。

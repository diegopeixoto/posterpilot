---
title: 貢献
description: PosterPilot をローカルで開発用にセットアップし、すべての変更がレビュー前に通過しなければならない品質ゲートを実行します。
---

Issue とプルリクエストを歓迎します。このページはローカルセットアップと品質ゲートを要約した
ものです。正規かつ常に最新の情報源は、リポジトリ内の
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md)
です。

## ローカルセットアップ

PosterPilot は [Bun](https://bun.sh) 上で動作する SvelteKit アプリです。

```sh
bun install
cp .env.example .env          # PLEX_URL / PLEX_TOKEN / TMDB_KEY を記入（または設定 UI を使用）
bun run db:generate           # Drizzle スキーマから SQL マイグレーションを生成（すでにコミット済み）
bun run dev                   # http://localhost:5173
```

マイグレーションはサーバー起動時に自動的に適用されます。

## 品質ゲート

すべての変更は、レビュー前にこれらを通過しなければなりません — CI も同じものを実行します：

```sh
bun run check     # svelte-check による型チェック
bun run test      # vitest ユニットテスト
bun run lint      # prettier --check（自動修正するには `bun run format` を実行）
```

このプロジェクトは、サーバーロジックについてはテスト駆動開発に従います — まず失敗するテストを
書き、それから実装します。純粋でテスト可能なロジックを `$env` / `$app` のインポートから
切り離して保ち、分離してユニットテストできるようにしてください（パターンについては既存の
テストを参照）。

## コミットメッセージ

このプロジェクトは [Conventional Commits](https://www.conventionalcommits.org/) を使用します。
タイプのプレフィックスが、release-please を通じて自動の変更履歴とバージョンの引き上げを駆動
します：

- `feat:` — 新機能（マイナーバンプ）
- `fix:` — バグ修正（パッチバンプ）
- `docs:`、`chore:`、`refactor:`、`test:`、`ci:` — それ単体ではリリースなし
- `feat!:` / `BREAKING CHANGE:` フッター — メジャーバンプ

例：`feat(library): add genre filter`。

## プルリクエスト

1. `main` からブランチを作成します。
2. 焦点を絞った変更を行います。diff を 1 つの関心事に限定して保ちます。
3. `check`、`test`、`lint` がグリーンであることを確認します。
4. テンプレートを使って PR を開き、関連する Issue をリンクします。

## 仕様駆動の変更

より大きな機能は `openspec/changes/` 下で
[OpenSpec](https://github.com/Fission-AI/OpenSpec) を使って計画されます。実質的な変更の場合は、
まず仕様を提案し、それからそのタスクに対して実装します。ケイパビリティ仕様は
`openspec/specs/` 下にあります。

## 翻訳

UI の翻訳を手伝うのにコーディングは不要です — Weblate のワークフローについては
[翻訳](/posterpilot/ja/translating/) を参照してください。

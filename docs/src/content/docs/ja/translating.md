---
title: 翻訳
description: Weblate を通じて PosterPilot の UI をあなたの言語に翻訳するのを手伝いましょう — コーディングは不要です。
---

UI をあなたの言語に翻訳するのを手伝いましょう！コーディングは不要です。このページは
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md#translators)
の翻訳者セクションを反映したものです。

UI は英語（デフォルト）、スペイン語、簡体字中国語、日本語、ブラジルポルトガル語に
ローカライズされており、**キーごとに英語へフォールバック** するため、翻訳されていない
文字列は常に読める英語を表示します — 生のキーになることは決してありません。

## 信頼できる情報源

ユーザー向けのすべての文字列は、`messages/` 下のロケールごとの JSON カタログにあります —
言語ごとに 1 つのファイルで、安定したメッセージ id をキーとしています：

- `messages/en.json` — 完全な **ソース** カタログ（すべてのメッセージ id）
- `messages/es.json` — スペイン語
- `messages/zh.json` — 簡体字中国語
- `messages/ja.json` — 日本語
- `messages/pt-BR.json` — ブラジルポルトガル語

その他のカタログは翻訳を保持しており、部分的な場合があります。ターゲットロケールで欠落または
空のままになっている id は、その英語のテキストにフォールバックします。`en.json` に追加された
新しい英語の文字列は、すべての言語で自動的に未翻訳エントリとして表示されます。

## Weblate 経由（推奨）

翻訳は、libre なウェブ翻訳プラットフォームである
[Weblate](https://hosted.weblate.org/engage/posterpilot/) を通じて、git ベースの
ワークフローで管理されます：

1. [Weblate の PosterPilot プロジェクト](https://hosted.weblate.org/engage/posterpilot/)
   を開いてサインインします — 無料アカウントで動作します。
2. あなたの言語を選び、ブラウザ内で未翻訳の文字列をそのまま翻訳します。
3. Weblate は変更を git 上でコミット/PR としてリポジトリに提案します。メンテナーがそれを
   マージします。

[![Translation status](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

Weblate コンポーネントは `messages/*.json` に対して、ソース言語を `en`、フォーマットを JSON
（キーと値）として構成されているため、常に現在のソースカタログを反映します。

## 直接のプルリクエスト経由

カタログを手作業で編集することもできます：`messages/en.json` から新しいキーを
`messages/<locale>.json` にコピーし、値を翻訳して、PR を開きます。

- キーはソースと同一に保ちます。翻訳するのは **値** だけです。
- 技術的な固有名詞は翻訳しないでください：**Plex、MediUX、TMDB、Kometa、Fanart.tv**。

## アクティブな言語が選ばれる方法

アクティブな言語はリクエストごとに解決されます：(1) あなたの永続化された設定（ヘッダーの
スイッチャーまたは設定で設定）、次に (2) ブラウザの `Accept-Language`、次に (3) 英語。詳細は
[設定 → 言語](/posterpilot/ja/configuration/) を参照してください。

翻訳に貢献することにより、あなたの貢献がプロジェクトの
[MIT license](https://github.com/diegopeixoto/posterpilot/blob/main/LICENSE) の下で
ライセンスされることに同意したものとみなされます。

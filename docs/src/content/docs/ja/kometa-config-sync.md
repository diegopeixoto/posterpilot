---
title: Kometa マネージャー
description: 正確なプレビューと確認、秘匿化 diff、原子的書き込み、プレビュー付き復元で config.yml を管理します。
---

[アートワークをメタデータとして出力](../usage/#kometa-がエクスポートを消費する方法)するだけでなく、**`/kometa`** で Kometa の `config.yml` を管理できます。パスが未設定ならファイルを読み書きしない任意機能です。

:::note[2 つのファイル]
- **`posterpilot.yml`** は TMDB ID ごとの `url_poster` / `url_background` で、Kometa 宛先へ適用すると書かれます。
- **`config.yml`** は Kometa の接続、ライブラリ、コレクション、オーバーレイ、操作、設定です。

`KOMETA_CONFIG_PATH` がある場合、`posterpilot.yml` は `config.yml` と同じディレクトリに置き、ファイル名で参照します。別のメタデータパスはありません。
:::

## 有効化とマウント

| 変数 | 既定 | 内容 |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | 空 | マウントした `config.yml` の絶対パス。空なら無効。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` は未管理内容を保持、`own` は全体を再生成。 |
| `KOMETA_SERVER_INSTANCE_ID` | 従来サーバー | Kometa に結び付ける名前付き Plex。 |

設定ディレクトリをコンテナへ読み書き可能でマウントします。[インストール](../installation/)を参照してください。Kometa は Plex 専用で、Jellyfin／Emby や別インスタンスの資格情報を暗黙に使うことは拒否します。

## 管理する領域

- Plex、TMDB、Tautulli、Trakt、MDBList、OMDb、GitHub、Radarr、Sonarr、Notifiarr、Gotify、ntfy、AniDB、MAL の**接続**（シークレットはマスク）。
- `metadata_files`、`collection_files`、オーバーレイ、操作、個別設定を含む**ライブラリ**。
- 選択したグローバル**設定と webhook**。
- ファイル全体の **Raw config.yml**。
- 書き込み時のタイムスタンプ付き**バックアップ**。

`merge` は管理キーだけを変更し、他のキーとコメントを残します。YAML anchor／alias を含むセクションは安全に部分更新できないため警告して省略します。必要なコネクターがない chart／overlay も整合性警告に出ます。

## 構造化プレビューと確認

1. パス、モード、Plex バインドを保存します。
2. PosterPilot が管理する領域を編集します。
3. **変更をプレビュー**します。
4. 追加、変更、削除、警告、秘匿化 diff を確認します。
5. **プレビュー済み同期を確認**します。

プランは期限付き、1 回限りで、ファイル指紋、Plex インスタンス、モード、提案内容全体に結び付いています。入力を変えると無効になります。古い、変更済み、期限切れ、再利用済みのプランは何も書きません。

## Raw エディター

**Raw 変更をプレビュー**は最初に YAML を検証します。構文エラーは画面内に表示し、プランを発行しません。**Raw 保存を確認**は別操作で、プレビューに結び付いたテキストだけを書きます。テキストまたはディスク上のファイル変更後は再プレビューが必要です。

## バックアップと復元

確定書き込みは原子的に置換し、以前の版を `config.yml.posterpilot-bak-<timestamp>` として保存します。復元も最初に diff をプレビューし、別に確認します。現在ファイルまたはバックアップが変わると拒否し、置換前に現在ファイルもバックアップします。

:::caution[平文のシークレット]
Kometa は `config.yml` 内の Plex トークンと TMDB キーを平文で必要とし、ディスク上のバックアップにも含まれます。PosterPilot は UI／diff では伏せますが、Kometa が読むファイルを暗号化できません。ボリュームと権限を保護してください。
:::

[安全性と元に戻す](../safety/) と [自動化と復旧](../automation-recovery/)も参照してください。

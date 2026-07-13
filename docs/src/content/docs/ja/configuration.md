---
title: 設定
description: 名前付きサーバー、プロバイダー、Kometa、自動化、バックアップ、セキュリティ、全環境変数を設定します。
---

PosterPilot は 2 つの設定元を組み合わせます。

- デプロイとシークレット管理向けの**環境変数**。
- `/data` の SQLite に保存される**アプリ内設定**。

同じ項目では**環境変数が常に優先**され、UI は環境管理として編集をロックします。保存したシークレットは AES-256-GCM で暗号化し、ブラウザーやログへ完全な値を返しません。

## 暗号化キー

未設定なら所有者のみ読める `data/.app-key` を生成します。`APP_SECRET` は移植可能なキーを導出して優先されます。移動／復元時は同じキーを保持してください。失うと資格情報の再入力が必要です。[自動化と復旧](../automation-recovery/)も参照してください。

## 名前付きメディアサーバー

**設定 → サーバー**で複数の Plex、Jellyfin、Emby を追加、テスト、有効化、切り替え、無効化、切断できます。Library、Review、コレクション、FUN、変更操作には 1 台がアクティブです。URL、暗号化資格情報、機能はインスタンスごとに分離されます。

従来の `SERVER_TYPE` と `PLEX_*` / `JELLYFIN_*` / `EMBY_*` は保護された既定サーバーを定義します。追加サーバーは DB に保存します。[複数サーバー移行](../multi-server-migration/)を参照してください。

- **Plex:** 手動トークン、またはセットアップの PIN ログイン／接続検出。
- **Jellyfin／Emby:** URL とキー／トークン。セットアップではユーザー名／パスワードを再利用可能トークンに交換し、パスワードは保存しません。

## TMDB、プロバイダー、スコア

`TMDB_KEY` は v3 キーまたは v4 bearer/JWT に対応します。MediUX と TMDB は既定で有効、Fanart.tv は `FANART_KEY` が必要、ThePosterDB は任意です。1 プロバイダーの失敗は他を止めず、既知候補を古い状態として保持できます。

**メタデータとプロバイダー**で優先順と、プロバイダー／解像度／縦横比の重みを調整します。プレビューと実行は同じ決定的設定を使います。`SUGGEST_PRESELECT` は候補を表示しますが、ステージは常に明示操作です。

## Kometa と適用方法

`DEFAULT_APPLY_METHOD` は `plex`（サーバー直接）、`kometa`、`both`。操作ごとの変更は保存済み既定値を変えません。

`posterpilot.yml` は `KOMETA_ASSETS_DIR` に出力しますが、`KOMETA_CONFIG_PATH` があれば `config.yml` と同じディレクトリです。`KOMETA_SERVER_INSTANCE_ID` は正確な Plex インスタンスを指定します。[Kometa マネージャー](../kometa-config-sync/)を参照してください。

## 自動化、バックアップ、診断

- **自動化:** サーバー／ライブラリごとの間隔、毎日時刻、イベント。Review 向けに同期／検索し、自動適用しません。
- **バックアップと復元:** `/data/backups` のバンドル、個数／日数保持、検証、エクスポート、プレビュー復元。保持設定に環境変数はありません。
- **診断:** サーバー、TMDB、プロバイダー、パスを変更せず検査し、明示操作で秘匿化サポートバンドルを出力します。

## セキュリティ、言語、FUN

`AUTH_MODE` は `disabled`、`local`、`enabled`。プロキシでは `ADDRESS_HEADER` と `XFF_DEPTH` で実クライアント IP を指定します。言語は `APP_LANGUAGE`、`Accept-Language`、英語の順です。`FUN_ENABLED` は 3 候補ピッカー、Poster Match、ギャラリー、セッションプランナーを有効にします。

## 環境変数一覧

| 変数 | 既定 | 内容 |
| --- | --- | --- |
| `SERVER_TYPE` | `plex` | 従来サーバーの種類: `plex`、`jellyfin`、`emby`。 |
| `PLEX_URL` | — | 既定 Plex のベース URL。 |
| `PLEX_TOKEN` | — | Plex トークン（シークレット）。 |
| `PLEX_CLIENT_ID` | 生成 | PIN／検出用の安定 ID。 |
| `JELLYFIN_URL` | — | Jellyfin ベース URL。 |
| `JELLYFIN_API_KEY` | — | Jellyfin キー／トークン（シークレット）。 |
| `EMBY_URL` | — | Emby ベース URL。 |
| `EMBY_API_KEY` | — | Emby キー／トークン（シークレット）。 |
| `TMDB_KEY` | — | TMDB v3 または v4 bearer/JWT（シークレット）。 |
| `KOMETA_ASSETS_DIR` | `./data/kometa`（Docker: `/kometa`） | config path がない場合の `posterpilot.yml` 出力先。 |
| `KOMETA_CONFIG_PATH` | — | `config.yml` 絶対パス。空ならマネージャー無効。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` または `own`。 |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Kometa に結び付ける Plex。 |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`、`kometa`、`both`。 |
| `INCLUDED_SECTIONS` | すべて | カンマ区切りキー。環境設定はサーバー別選択より優先。 |
| `PROVIDER_MEDIUX` | 有効 | MediUX を有効化。 |
| `PROVIDER_TMDB` | 有効 | TMDB 画像を有効化。 |
| `PROVIDER_FANART` | 無効 | Fanart.tv を有効化。 |
| `PROVIDER_THEPOSTERDB` | 無効 | ThePosterDB を有効化。 |
| `FANART_KEY` | — | Fanart.tv キー（シークレット）。 |
| `MEDIUX_REQUEST_DELAY_MS` | `2000` | MediUX 要求間隔（ms）。 |
| `MEDIUX_CONCURRENCY` | `5` | MediUX 同時要求数。 |
| `HTTP_CACHE_TTL_DAYS` | `7` | HTTP キャッシュ日数。 |
| `APPLY_CONCURRENCY` | `4` | 一括適用の同時項目数。 |
| `SUGGEST_PRESELECT` | 有効 | 明示的な候補を計算／表示。 |
| `INCREMENTAL_SYNC` | 有効 | 通常同期で未変更項目を省略。 |
| `LIBRARY_DEFAULT_SORT` | `title` | `title`、`year`、`rating`、`runtime`、`recent`、`added`。 |
| `FUN_ENABLED` | 無効 | FUN ツールを表示。 |
| `THUMB_CACHE_TTL_DAYS` | `30` | サムネイル有効日数。 |
| `THUMB_CACHE_MAX_MB` | `512` | サムネイルキャッシュ上限 MB。 |
| `APP_LANGUAGE` | 自動 | `en`、`es`、`zh`、`ja`、`pt-BR`。 |
| `AUTH_MODE` | `disabled` | `disabled`、`local`、`enabled`。UI より優先。 |
| `ADDRESS_HEADER` | — | プロキシ配下の実 IP ヘッダー。 |
| `XFF_DEPTH` | — | 信頼するプロキシ数。 |
| `MAX_UPLOAD_MB` | `15` | 画像アップロード上限。 |
| `LOG_DIR` | `./data/logs`（Docker: `/data/logs`） | ローテーションログ先。 |
| `EVENT_RETENTION` | `2000` | DB の最大イベント数。 |
| `DATABASE_URL` | `file:./data/posterpilot.db` | SQLite の libsql URL。 |
| `PORT` | `3000` | HTTP ポート。 |
| `APP_SECRET` | — | 暗号化キーを導出し `.app-key` より優先。 |
| `APP_KEY_FILE` | `./data/.app-key` | 生成キーのパス。 |

真偽値は `1`、`true`、`on`、`yes` を受け付けます。`DATABASE_URL`、`PORT`、`APP_SECRET`、`APP_KEY_FILE`、`ADDRESS_HEADER`、`XFF_DEPTH`、`MAX_UPLOAD_MB` は環境変数専用です。

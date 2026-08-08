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

ThePosterDB はアカウントなしで動作しますが、一部のページでは匿名アクセスに実際のポスターの代わりにプレースホルダー画像を返します。実画像を取得するには、**任意で**サインインできます — **メタデータとプロバイダー**（ThePosterDB を有効にするとフィールドが表示）または `THEPOSTERDB_USERNAME` / `THEPOSTERDB_PASSWORD` で設定します。パスワードは他のシークレットと同様に保存時に暗号化され、サインインに失敗した場合はその実行を匿名スクレイピングにフォールバックし、検索を止めません。匿名スクレイピングに戻すにはユーザー名を空にします（サインインには両方が必要です）。保存済みパスワードは暗号化されたままデータベースに残り、ユーザー名を再入力すると再び使われます。削除するには、パスワード欄の下の**保存済みパスワードを削除**を使ってください——保存すると取り除かれます。

![ThePosterDB を有効にし、任意のユーザー名とパスワードのフィールドを表示した PosterPilot のプロバイダー設定](/posterpilot/screenshots/settings-providers.webp)

**メタデータとプロバイダー**で優先順と、プロバイダー／解像度／縦横比の重みを調整します。プレビューと実行は同じ決定的設定を使います。`SUGGEST_PRESELECT` は候補を表示しますが、ステージは常に明示操作です。

## TMDB アートワークの言語

`TMDB_ARTWORK_LANGUAGE`（既定 `any`）は、どの言語の TMDB アートワークを閲覧し自動選択の対象にするかを決めます。`APP_LANGUAGE` とは意図的に独立です。`any` は TMDB が返したすべての言語を保持し、`ui` は UI 言語をベースコードに正規化して従い（`pt-BR` の UI は `pt` を優先）、`en`、`de` などの ISO 639-1 ベースコードを直接指定することもできます。明示コードは翻訳済みの 6 UI ロケールに限りません。認識できない値は未設定として扱われ、壊れた絞り込みを適用せず `any` に戻ります。他の設定と同様に環境変数が優先され、設定画面では環境管理として表示されます。

TMDB が言語を付けていないアートワークは言語中立として扱われ、どの設定でも残ります。したがって中立のアートワークしかないペインが設定によって空になることはありません。検索は常にすべての言語を保持します——設定が制御するのは閲覧と自動選択であり、ダウンロード対象ではありません——ので、変更しても既存の候補を絞り込み直すだけで、再検索は不要です。自動選択が他言語のポスターを使うのは、優先言語と未タグの候補がどちらも存在しない場合だけで、そのときはラベルで示されます。アイテムページには一時的な**優先／すべて**の切り替えもあり、グローバル設定を変えずに 1 作品だけ設定を越えて確認できます。

## 候補インベントリと「さらに読み込む」

TMDB の取り込みは以前、**アートワークの種類ごと**に 20 件で打ち切られていました。ポスターと背景は別々に数えられるため、「カバーが 40 件で頭打ち」という報告はここから生じています。現在ははるかに多くを、TMDB 自身のファイル識別子で重複排除し TMDB の並び順を保ったまま保持します。プロバイダー／種類ごとのペインは限定された一括分を表示し、あと何件が隠れているかを示す**さらに読み込む**操作を備えます。ポスターと背景のペインは独立して展開します。検索には依然として**アートワークの種類ごとに 200 件**という防御的上限があります。これは保存と描画のための上限であって品質フィルターではなく、ペインがそれに達した場合は、TMDB のすべてを表示しているかのように見せるのではなく、インベントリが**切り詰められた**ことを示します。

## Kometa と適用方法

`DEFAULT_APPLY_METHOD` は `plex`（サーバー直接）、`kometa`、`both`。操作ごとの変更は保存済み既定値を変えません。

`posterpilot-movies.yml`（TMDB）と `posterpilot-shows.yml`（TVDB、なければ IMDb）を `KOMETA_ASSETS_DIR` に出力します。`KOMETA_CONFIG_PATH` があれば `config.yml` と同じディレクトリです。`KOMETA_SERVER_INSTANCE_ID` は正確な Plex インスタンスを指定し、`KOMETA_METADATA_PATH_PREFIX` は物理パスではなく Kometa から見える相対参照を指定します。[Kometa マネージャー](../kometa-config-sync/)を参照してください。

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
| `KOMETA_ASSETS_DIR` | `./data/kometa`（Docker: `/kometa`） | config path がない場合の型別 YAML 出力先。 |
| `KOMETA_CONFIG_PATH` | — | `config.yml` 絶対パス。空ならマネージャー無効。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` または `own`。 |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Kometa に結び付ける Plex。 |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Kometa 実行環境から見える相対ディレクトリ。`.` はファイル名だけ。 |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`、`kometa`、`both`。 |
| `INCLUDED_SECTIONS` | すべて | カンマ区切りキー。環境設定はサーバー別選択より優先。 |
| `PROVIDER_MEDIUX` | 有効 | MediUX を有効化。 |
| `PROVIDER_TMDB` | 有効 | TMDB 画像を有効化。 |
| `PROVIDER_FANART` | 無効 | Fanart.tv を有効化。 |
| `PROVIDER_THEPOSTERDB` | 無効 | ThePosterDB を有効化。 |
| `FANART_KEY` | — | Fanart.tv キー（シークレット）。 |
| `THEPOSTERDB_USERNAME` | — | サインインしてスクレイピングするための任意の ThePosterDB ユーザー名またはメール。 |
| `THEPOSTERDB_PASSWORD` | — | 任意の ThePosterDB アカウントのパスワード（シークレット、暗号化保存）。 |
| `TMDB_ARTWORK_LANGUAGE` | `any` | 閲覧と自動選択の対象にする TMDB アートワークの言語: `any`、`ui`（UI 言語に追従）、または `en` などの ISO 639-1 ベースコード。無効な値は `any` に戻ります。 |
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
| `APP_LANGUAGE` | 自動 | `en`、`es`、`zh`、`ja`、`pt-BR`、`fr`。 |
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

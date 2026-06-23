---
title: インストール
description: 公式の GHCR イメージを使い、PosterPilot を単一の Docker コンテナとして実行します。macOS と Unraid 向けの Docker Compose の例付き。
---

PosterPilot は単一の Docker コンテナとして動作します。同じマルチアーキテクチャイメージ
（`amd64` + `arm64`）が、Mac、Unraid サーバー、またはその他の Docker が動作する場所で
実行されます。

## 公式イメージ

公式のビルド済みイメージは GitHub Container Registry に公開されています：

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

タグはリリースに従います。`:latest` は最新のリリースを追跡します。再現性のある
アップグレードを好む場合は、代わりに特定のバージョンタグに固定できます。

## ボリュームとポート

2 つのボリュームが重要です：

- **`/data`** — 永続的なアプリの状態：SQLite データベース、保存した設定、
  および適用履歴。コンテナの更新後も状態が残るよう、マウントされたボリューム上に保持してください。
- **`/kometa`** — Kometa のアセット／設定ディレクトリをここにマウントすることで、
  エクスポートされた YAML が Kometa が読み取る場所に配置されます。Kometa エクスポートを使う場合のみ必要です。

コンテナはデフォルトでポート **3000** をリッスンします（`PORT` 環境変数で設定可能）。UI に
アクセスするには、ホストのポートに公開してください。

## Docker Compose（macOS）

`docker-compose.yml` を作成します：

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    healthcheck:
      test:
        [
          'CMD',
          'bun',
          '-e',
          "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # 任意 — 代わりにアプリ内の設定ページでこれらを設定することもできます:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
    volumes:
      # 永続的なアプリの状態（SQLite db + 設定 + 履歴）。
      - ./data:/data
      # エクスポートされた YAML が取り込まれるよう、Kometa のアセット／設定ディレクトリをここにマウントします。
      - ./data/kometa:/kometa
    restart: unless-stopped
```

それから起動します：

```sh
docker compose up -d
# UI at http://localhost:3000
```

リポジトリに同梱されている `docker-compose.yml` は同じ構成で、イメージをプルする代わりに
ローカルでビルドしたい場合の `build: .` オプションを含んでいます：

```sh
docker compose up -d --build
```

## Unraid（Community Apps テンプレート）

リポジトリは `unraid/posterpilot.xml` に Community Apps テンプレートを同梱しています。
Unraid の UI で **Docker → Add Container** に移動し、これを _Template_ フィールドに貼り付けます：

```
https://raw.githubusercontent.com/diegopeixoto/posterpilot/main/unraid/posterpilot.xml
```

これは GHCR イメージ、WebUI ポート、`/data` と `/kometa` のボリューム、および任意の
認証情報フィールド（Plex / Jellyfin / Emby、TMDB、Fanart.tv、言語）を事前入力します —
これらはすべて後から設定ページでも構成できます。

## Docker Compose（Unraid）

Compose の方が好みですか？ボリュームを `appdata` 共有に向けてください — 特に、エクスポート
された YAML が Kometa がすでに読み取っている場所に配置されるよう、Kometa ボリュームを
**既存の** Kometa 設定ディレクトリに向けてください：

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # 任意 — または設定ページでこれらを構成します:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
    volumes:
      - /mnt/user/appdata/posterpilot:/data
      - /mnt/user/appdata/kometa/config:/kometa
    restart: unless-stopped
```

`PLEX_URL` / `PLEX_TOKEN` / `TMDB_KEY` をコンテナの環境に設定するか、空白のままにして
設定ページですべてを構成し、それからポート 3000 でコンテナにアクセスしてください。

## 初回実行

1. コンテナを起動し、`http://<host>:3000`（例：
   `http://localhost:3000`）を開きます。
2. 初回実行時はまだライブラリが同期されていないため、ライブラリウォールには空の
   状態が表示され、メディアサーバーの設定と同期の実行を促されます。
3. **設定** を開いて、メディアサーバーと TMDB キーを接続します（
   [設定](/posterpilot/ja/configuration/) を参照）。環境変数経由で認証情報を設定した場合、
   それらは設定済みかつ編集ロック済みとして表示されます。
4. 同期を実行し、それからカバーの検索と適用を始めます（
   [使い方](/posterpilot/ja/usage/) を参照）。

## ヘルスチェック

アプリは認証不要の `GET /api/health` を公開しており、HTTP 200 とともに
`{ "status": "ok", "version": "x.y.z" }` を返します — コンテナのヘルスプローブとして
使用してください（同梱の `docker-compose.yml` はすでにそうしています）：

```sh
curl -s http://localhost:3000/api/health
```

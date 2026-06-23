---
title: 安装
description: 使用官方 GHCR 镜像将 PosterPilot 作为单个 Docker 容器运行，并提供适用于 macOS 和 Unraid 的 Docker Compose 示例。
---

PosterPilot 作为单个 Docker 容器运行。同一个多架构镜像
（`amd64` + `arm64`）可在 Mac、Unraid 服务器，或任何其他可运行 Docker
的地方运行。

## 官方镜像

官方预构建镜像发布在 GitHub Container Registry：

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

标签跟随版本发布；`:latest` 跟踪最新发布版本。如果你倾向于可重现的升级，
也可以改为固定到某个特定版本标签。

## 卷和端口

有两个卷很重要：

- **`/data`** — 持久化的应用状态：SQLite 数据库、你保存的设置，
  以及应用历史。请将其放在挂载卷上，以便状态在
  容器更新后仍能保留。
- **`/kometa`** — 在此挂载你的 Kometa 资产/配置目录，以便导出的
  YAML 落到 Kometa 读取的位置。仅在你使用 Kometa 导出时才需要。

容器默认监听 **3000** 端口（可通过 `PORT`
环境变量配置）。将其发布到主机端口即可访问界面。

## Docker Compose（macOS）

创建一个 `docker-compose.yml`：

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
      # 可选——你也可以改为在应用内的设置页面中设置这些：
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
    volumes:
      # 持久化应用状态（SQLite 数据库 + 设置 + 历史）。
      - ./data:/data
      # 在此挂载你的 Kometa 资产/配置目录，以便拾取导出的 YAML。
      - ./data/kometa:/kometa
    restart: unless-stopped
```

然后启动它：

```sh
docker compose up -d
# 界面位于 http://localhost:3000
```

仓库中自带的 `docker-compose.yml` 结构相同，并包含
一个 `build: .` 选项，如果你更愿意在本地构建镜像而非
拉取它：

```sh
docker compose up -d --build
```

## Unraid（Community Apps 模板）

仓库在 `unraid/posterpilot.xml` 处提供了一个 Community Apps 模板。在
Unraid 界面中进入 **Docker → Add Container**，并将以下内容粘贴到 _Template_ 字段中：

```
https://raw.githubusercontent.com/diegopeixoto/posterpilot/main/unraid/posterpilot.xml
```

它会预填 GHCR 镜像、WebUI 端口、`/data` 和 `/kometa` 卷，以及
可选的凭据字段（Plex / Jellyfin / Emby、TMDB、Fanart.tv、语言）——
所有这些你之后也都可以在设置页面中配置。

## Docker Compose（Unraid）

更喜欢用 Compose？将卷指向你的 `appdata` 共享——尤其要将
Kometa 卷指向你**现有的** Kometa 配置目录，以便导出的 YAML 落到
Kometa 已经读取的位置：

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
      # 可选——或在设置页面中配置这些：
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
    volumes:
      - /mnt/user/appdata/posterpilot:/data
      - /mnt/user/appdata/kometa/config:/kometa
    restart: unless-stopped
```

在容器的环境中设置 `PLEX_URL` / `PLEX_TOKEN` / `TMDB_KEY`，或将
它们留空并通过设置页面配置所有内容，然后在 3000 端口浏览
该容器。

## 首次运行

1. 启动容器并打开 `http://<host>:3000`（例如
   `http://localhost:3000`）。
2. 首次运行时还没有同步任何媒体库，因此库墙会显示一个空
   状态，提示你配置媒体服务器并运行同步。
3. 打开 **设置** 并连接媒体服务器和 TMDB 密钥（参见
   [配置](/posterpilot/zh/configuration/)）。如果你通过
   环境变量设置了凭据，它们会显示为已配置并被锁定，无法编辑。
4. 运行同步，然后开始查找和应用封面（参见
   [使用](/posterpilot/zh/usage/)）。

## 健康检查

应用提供了一个无需认证的 `GET /api/health`，它返回
`{ "status": "ok", "version": "x.y.z" }` 并附带 HTTP 200——可将其用作容器
健康探针（自带的 `docker-compose.yml` 已经这样做了）：

```sh
curl -s http://localhost:3000/api/health
```

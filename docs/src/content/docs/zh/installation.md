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

- **`/data`** — 持久化的应用状态：SQLite 数据库、你保存的设置、
  应用历史，以及滚动的日志文件（`/data/logs/posterpilot.log`）。
  请将其放在挂载卷上，以便状态在容器更新后仍能保留；日志文件
  位于 `/data` 内部，因此无需为它额外挂载卷。
- **`/kometa`** — 在此挂载你的 Kometa 资产/配置目录，以便导出的
  YAML 落到 Kometa 读取的位置。仅在你使用 Kometa 导出时才需要。

容器默认监听 **3000** 端口（可通过 `PORT`
环境变量配置）。将其发布到主机端口即可访问界面。

## 已存储密钥的加密密钥

PosterPilot 会对密钥设置（媒体服务器 token 和提供方 API 密钥）进行
静态加密。默认情况下，它会在首次运行时于 `data/.app-key` 自动生成一个
实例密钥——**无需任何设置**。由于该密钥位于 `/data` 卷内部，将 `/data`
保存在持久、有备份的存储上，可使你的密钥在容器更新后仍能被解密。

你也可以选择设置 **`APP_SECRET`** 环境变量，以改为从你掌控的某个值
派生密钥。当你运行 **多个共享同一数据库的副本** 时，或当你希望在容器
（及其 `data/.app-key`）被重建时密钥仍保持可移植时，请设置它。如果你不
设置 `APP_SECRET`，请将 `data/.app-key` 视为备份的一部分——丢失它意味着
要重新输入每一个已保存的凭据。关于完整行为，参见
[配置 → 密钥与加密](/posterpilot/zh/configuration/#密钥与加密)。

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
      # 可选——派生静态加密密钥（否则会在 data/.app-key 自动生成）：
      # APP_SECRET: ${APP_SECRET:-}
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

## Unraid（Community Apps）

PosterPilot 已上架 **Unraid Community Apps** 应用商店。打开 **Apps** 标签页，
搜索 **PosterPilot**，然后点击 _Install_。

想手动添加？仓库同样在 `unraid/posterpilot.xml` 处提供了模板。在
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
      # 可选——派生静态加密密钥（否则会在 data/.app-key 自动生成）：
      # APP_SECRET: ${APP_SECRET:-}
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
2. 首次运行时还没有同步任何内容。一个横幅会指向位于 `/setup`
   的 **首次安装向导**，它会带你完成六个步骤：选择语言、
   连接媒体服务器、添加 TMDB 密钥、启用封面提供方、选择要同步的
   媒体库，以及运行首次同步。对于 Plex，该向导包含 PIN 登录和
   连接发现，这样你就永远不必粘贴 token 或 URL。该向导可跳过——
   你也可以改为在 **设置** 中配置所有内容。
3. 如果你通过环境变量设置了凭据，它们会在向导和设置中都
   显示为已配置并被锁定，无法编辑（参见
   [配置](/posterpilot/zh/configuration/)）。
4. 同步完成后，开始查找和应用封面（参见
   [使用](/posterpilot/zh/usage/)）。

## 健康检查

应用提供了一个无需认证的 `GET /api/health`，它返回
`{ "status": "ok", "version": "x.y.z" }` 并附带 HTTP 200——可将其用作容器
健康探针（自带的 `docker-compose.yml` 已经这样做了）：

```sh
curl -s http://localhost:3000/api/health
```

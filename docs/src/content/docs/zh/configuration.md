---
title: 配置
description: 连接媒体服务器、设置你的 TMDB 密钥、启用封面提供方、配置 Kometa 导出，并使用完整的环境变量参考。
---

PosterPilot 通过两种方式配置，二者协同工作：

- **环境变量** — 在容器上设置。适合无人值守的部署
  和密钥管理。
- **应用内的设置页面** — 在界面中输入并持久化到 `/data` 下的 SQLite
  数据库，使其在重启后仍然保留。设置被组织为若干标签页：**媒体服务器**、
  **元数据与提供方**、**Kometa 与高级**、**语言**，以及 **活动**
  （应用内的事件日志）。位于 `/setup` 的引导式
  [首次安装向导](/posterpilot/zh/installation/#首次运行)会按顺序
  覆盖全新安装的同样内容。

## 环境变量 vs. 设置界面

对于任意给定的设置，**环境变量始终优先于**
持久化的界面值。当某个值通过环境提供时，
设置页面会将其显示为 _由环境管理_ 并将其在
界面中锁定，无法编辑——这样真实来源就明确无歧义。

如果某个值在两处都未设置，则应用其文档记录的默认值（如有），或
依赖它的功能会保持未配置状态，直到你设置它为止。

密钥（Plex token、Jellyfin/Emby API 密钥、TMDB 凭据，以及
Fanart.tv 密钥）在保存后绝不会回显到浏览器，并且会
从日志中脱敏——设置页面只会指示某个密钥 _已设置_。

## 媒体服务器

PosterPilot 一次只与一个活动的媒体服务器通信，由 `SERVER_TYPE`
选择（`plex`、`jellyfin` 或 `emby`；默认为 `plex`）。同步之前只会验证
活动服务器的凭据。

### Plex

Plex 需要一个基础 URL 和一个 `X-Plex-Token`。你可以通过三种方式提供它们：

- **PIN 登录（推荐）。** 在设置中，启动一次 Plex 登录。PosterPilot
  会在 plex.tv 上创建一个强 PIN，向你显示一个代码和一个授权链接，
  并轮询直到你授权它——然后它会为你存储获取到的 token，这样你
  就永远不必去查找并粘贴原始 token。如果 PIN 在你授权前过期，
  只需启动一次新的登录即可。
- **连接发现。** 一旦有了可用的 token，PosterPilot 就可以从 plex.tv 发现
  你的 Plex 服务器及其连接，并将每个连接标注为
  **local** 或 **remote**（中继会被标记）。选择其中一个，而不是手动输入 URL；
  所选连接会在被保存为活动的 Plex 基础 URL 之前通过连接测试进行验证。
- **手动。** 直接粘贴基础 URL（例如 `http://192.168.1.10:32400`）和一个
  `X-Plex-Token`。

### Jellyfin

Jellyfin 需要一个基础 URL（`JELLYFIN_URL`）和一个 API 密钥（`JELLYFIN_API_KEY`）。
设置 `SERVER_TYPE=jellyfin` 使其成为活动服务器。海报和背景会被上传到
Jellyfin 图像 API（海报用 `Primary`，背景用 `Backdrop`）。
Jellyfin 没有 PIN 登录或连接发现——请直接提供 URL 和 API 密钥。

:::note
Plex 路径经过了最充分的实战检验；Jellyfin 和 Emby 集成则较新。
它们运行在同一个媒体服务器接口之后，因此同步、发现和应用的工作方式
完全相同——但如果你遇到某个特定于服务器的怪异问题，请提交一个 issue。
:::

### Emby

Emby 需要一个基础 URL（`EMBY_URL`）和一个 API 密钥（`EMBY_API_KEY`）。设置
`SERVER_TYPE=emby` 使其成为活动服务器。与 Jellyfin 一样，Emby 直接使用
URL + API 密钥（没有 PIN 登录或连接发现）。

## TMDB 密钥

需要一个 [TMDB](https://www.themoviedb.org/) API 凭据：PosterPilot
会将每个已同步的标题解析为 TMDB id（以便准确地查询提供方），
并且 TMDB 本身也是封面提供方之一。可通过 `TMDB_KEY` 或在
设置中设置它。**v3 API 密钥** 和 **v4 bearer/JWT token** 都被接受——
格式会被自动检测。

## 封面提供方

PosterPilot 在发现过程中跨多个封面提供方发散查找，并
合并它们的候选项，为每个候选项标记其来源提供方。每个
提供方都可以独立启用或禁用，可在设置中或通过其
环境变量进行。

| 提供方          | 默认值  | 需要密钥          | 说明                                                            |
| --------------- | ------- | ----------------- | --------------------------------------------------------------- |
| **MediUX**      | on      | 否                | 带上传者署名的、抓取的海报/背景套图。                           |
| **TMDB**        | on      | 复用 `TMDB_KEY`   | 来自 TMDB 图像端点的海报和背景。                               |
| **Fanart.tv**   | off     | `FANART_KEY`      | 来自 Fanart.tv API 的海报、背景和徽标。                        |
| **ThePosterDB** | off     | 否                | 抓取的社区海报/背景套图，经过限速和缓存。                       |

Fanart.tv 是唯一需要密钥的提供方：如果它已启用但没有配置 `FANART_KEY`，
发现过程会跳过它并呈现缺少凭据的状况，
而不是使整个运行失败。某个提供方的失败、超时或无法解析的响应
永远不会阻止其他提供方返回候选项。

## Kometa 导出

当你使用 Kometa 方法应用封面时，PosterPilot 会将
Kometa/PMM 兼容的 YAML（`url_poster` / `url_background`，以 TMDB id 为键）写入
由 `KOMETA_ASSETS_DIR` 命名的目录（在 Docker 中默认为 `/kometa`）。将
该路径挂载到你现有的 Kometa 配置目录，以便 Kometa 在下次运行时应用这些封面。
关于导出如何被使用，参见 [使用](/posterpilot/zh/usage/#应用封面)。

## 语言

界面语言按请求解析：(1) 当首选语言设置命名了
受支持的区域设置时使用它，然后 (2) 请求的 `Accept-Language` 标头，然后
(3) 英语。可通过 `APP_LANGUAGE`、通过设置页面，或
通过页眉中的语言切换器设置首选语言。受支持的区域设置为英语（`en`）、西班牙语
（`es`）、简体中文（`zh`）、日语（`ja`）和巴西葡萄牙语
（`pt-BR`）。未设置或不受支持的值会回退到 `Accept-Language`，然后
回退到英语——永远不会出错，也永远不会显示原始键。

## 日志与活动日志

每一个操作事件都会以三种方式记录：镜像到容器控制台、
作为一行插入到应用内的 **活动** 日志（设置 → 活动），
并追加到一个滚动的日志文件。该文件是位于 `LOG_DIR`（在 Docker 中
默认为 `/data/logs`）内的 `posterpilot.log`；当它增长超过约 5 MB 时
会轮转（`posterpilot.log` → `.1` → `.2` …），保留约五个文件。由于
默认位置位于 `/data` 之下，现有的 `/data` 卷已经将其持久化——无需
额外挂载。

活动日志表的行数上限为 `EVENT_RETENTION`（默认 `2000`）；
更早的行会被自动修剪。你可以随时用活动标签页上的
**清除活动** 按钮清空该表（这不会删除磁盘上的日志文件）。

## 环境变量参考

下面的每一项设置都可以作为环境变量提供。大多数也可在
设置页面中编辑；当通过环境设置时，它们优先生效
并在界面中被锁定。

| 变量                      | 设置                      | 默认值                                | 含义                                                                                          |
| ------------------------- | ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SERVER_TYPE`             | 服务器类型                | `plex`                                | 活动媒体服务器：`plex`、`jellyfin` 或 `emby`。                                                |
| `PLEX_URL`                | Plex URL                  | —                                     | Plex 基础 URL，例如 `http://192.168.1.10:32400`。                                             |
| `PLEX_TOKEN`              | Plex token（密钥）        | —                                     | 你的 `X-Plex-Token`。                                                                         |
| `PLEX_CLIENT_ID`          | Plex 客户端 id            | 生成                                  | 发送到 plex.tv 用于 PIN 登录 / 发现的、稳定的每安装标识符。                                    |
| `JELLYFIN_URL`            | Jellyfin URL              | —                                     | Jellyfin 基础 URL（当 `SERVER_TYPE=jellyfin` 时）。                                           |
| `JELLYFIN_API_KEY`        | Jellyfin API 密钥（密钥） | —                                     | Jellyfin API 密钥。                                                                            |
| `EMBY_URL`                | Emby URL                  | —                                     | Emby 基础 URL（当 `SERVER_TYPE=emby` 时）。                                                   |
| `EMBY_API_KEY`            | Emby API 密钥（密钥）     | —                                     | Emby API 密钥。                                                                                |
| `TMDB_KEY`                | TMDB 密钥（密钥）         | —                                     | TMDB v3 API 密钥 **或** v4 bearer/JWT（自动检测）。                                           |
| `KOMETA_ASSETS_DIR`       | Kometa 资产目录           | `./data/kometa`（Docker 中为 `/kometa`） | 导出的 Kometa YAML 写入的目录。                                                               |
| `DEFAULT_APPLY_METHOD`    | 默认应用方法              | `both`                                | 默认应用方法：`plex`、`kometa` 或 `both`。                                                    |
| `INCLUDED_SECTIONS`       | 包含的分区                | 全部电影/剧集                         | 要同步的库分区键；逗号分隔（env）或 JSON 数组（持久化）。留空 = 全部。                         |
| `PROVIDER_MEDIUX`         | MediUX 提供方             | on                                    | 启用 MediUX 提供方。                                                                           |
| `PROVIDER_TMDB`           | TMDB 提供方               | on                                    | 启用 TMDB 封面提供方。                                                                         |
| `PROVIDER_FANART`         | Fanart.tv 提供方          | off                                   | 启用 Fanart.tv 提供方（需要 `FANART_KEY`）。                                                  |
| `PROVIDER_THEPOSTERDB`    | ThePosterDB 提供方        | off                                   | 启用 ThePosterDB 提供方。                                                                      |
| `FANART_KEY`              | Fanart.tv 密钥（密钥）    | —                                     | Fanart.tv API 密钥（唯一需要密钥的提供方）。                                                   |
| `MEDIUX_REQUEST_DELAY_MS` | MediUX 请求延迟           | `2000`                                | MediUX 请求之间的延迟，单位为毫秒（限速）。                                                    |
| `MEDIUX_CONCURRENCY`      | MediUX 并发数             | `5`                                   | 最大并发 MediUX 请求数。                                                                       |
| `HTTP_CACHE_TTL_DAYS`     | HTTP 缓存 TTL             | `7`                                   | 缓存的 HTTP 响应（抓取）被复用的时长，单位为天。                                               |
| `APP_LANGUAGE`                | 语言                      | —（自动）                             | 首选界面区域设置：`en`、`es`、`zh`、`ja` 或 `pt-BR`。                                         |
| `LOG_DIR`                 | —                         | `/data/logs`（Docker）                | 滚动的 `posterpilot.log` 文件所在的文件夹（约 5 MB × 5 个文件）。                             |
| `EVENT_RETENTION`         | —                         | `2000`                                | 数据库中保留的活动日志行数上限（更早的行会被修剪）。                                          |
| `DATABASE_URL`            | —                         | `file:/data/posterpilot.db`（Docker） | SQLite 数据库的 libsql 文件 URL。                                                             |
| `PORT`                    | —                         | `3000`                                | 监听端口。                                                                                     |

布尔标志接受 `1` / `true` / `on` / `yes`（不区分大小写）表示 _启用_；
其他任何值（或未设置）都会保留文档记录的默认值。

:::note
`DATABASE_URL`、`PORT`、`LOG_DIR` 和 `EVENT_RETENTION` 是部署级设置——
它们仅从环境中读取，不属于应用内的设置页面。
:::

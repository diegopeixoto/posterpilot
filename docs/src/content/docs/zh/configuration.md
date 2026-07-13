---
title: 配置
description: 配置命名服务器、提供方、Kometa、自动化、备份、安全以及所有支持的环境变量。
---

PosterPilot 会组合两种配置来源：

- 适合部署与密钥管理的**环境变量**；
- 持久化到 `/data` 下 SQLite 的**应用内设置**。

同一选项始终以**环境变量优先**，界面会标记为环境管理并禁止编辑。保存的密钥使用 AES-256-GCM 加密，绝不会完整返回浏览器或日志。

## 加密密钥

未配置时，PosterPilot 会创建仅所有者可读的 `data/.app-key`。`APP_SECRET` 可派生便携密钥并优先于该文件。迁移或恢复时必须保留同一密钥，否则需要重新输入凭据。参阅[自动化与恢复](../automation-recovery/)。

## 命名媒体服务器

在**设置 → 服务器**可以添加、测试、启用、切换、禁用或断开多个 Plex、Jellyfin 和 Emby。媒体库、Review、合集、FUN 与修改操作使用一个活动实例。每个实例拥有独立 URL、加密凭据和能力。

旧版 `SERVER_TYPE` 及 `PLEX_*` / `JELLYFIN_*` / `EMBY_*` 定义受保护的默认服务器。其他服务器保存在数据库中，参阅[多服务器迁移](../multi-server-migration/)。

- **Plex：**手动令牌，或设置向导中的 PIN 登录／连接发现。
- **Jellyfin／Emby：**URL 与密钥／令牌；向导也能把用户名密码换成可重用令牌，密码不会保存。

## TMDB、提供方与评分

`TMDB_KEY` 支持 v3 密钥或 v4 bearer/JWT。MediUX 与 TMDB 默认启用；Fanart.tv 需要 `FANART_KEY`；ThePosterDB 可选。一个提供方失败不会阻止其他提供方，并可保留已知候选标记为陈旧。

在**元数据与提供方**中调整提供方优先级以及提供方、分辨率、宽高比权重。预览与执行使用同一确定性配置。`SUGGEST_PRESELECT` 显示最佳建议，但接受／暂存始终需要明确操作。

## Kometa 与应用方式

`DEFAULT_APPLY_METHOD` 可为 `plex`（直接服务器）、`kometa` 或 `both`。单次操作切换不会修改已保存默认值。

导出通常写入 `KOMETA_ASSETS_DIR`；设置 `KOMETA_CONFIG_PATH` 后，`posterpilot.yml` 会与 `config.yml` 同目录。`KOMETA_SERVER_INSTANCE_ID` 必须指向准确的 Plex 实例。参阅 [Kometa 管理器](../kometa-config-sync/)。

## 自动化、备份与诊断

- **自动化：**按服务器／媒体库设置间隔、每天时间或事件；同步／发现到 Review，绝不自动应用。
- **备份与恢复：**`/data/backups` 下的包、按数量／天数保留、验证、导出和预览恢复。保留策略保存在应用内，没有环境变量。
- **诊断：**无修改检查服务器、TMDB、提供方和路径，并在明确操作后导出脱敏支持包。

## 安全、语言与 FUN

`AUTH_MODE` 为 `disabled`、`local` 或 `enabled`。反向代理后请设置 `ADDRESS_HEADER` 和 `XFF_DEPTH` 以使用真实客户端 IP。语言顺序为 `APP_LANGUAGE`、`Accept-Language`、英语。`FUN_ENABLED` 启用三选一、Poster Match、画廊和观影时段规划。

## 完整环境变量参考

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `SERVER_TYPE` | `plex` | 旧版服务器类型：`plex`、`jellyfin`、`emby`。 |
| `PLEX_URL` | — | 默认 Plex 基础 URL。 |
| `PLEX_TOKEN` | — | Plex 令牌（密钥）。 |
| `PLEX_CLIENT_ID` | 自动生成 | PIN／发现使用的稳定 ID。 |
| `JELLYFIN_URL` | — | Jellyfin 基础 URL。 |
| `JELLYFIN_API_KEY` | — | Jellyfin 密钥／令牌。 |
| `EMBY_URL` | — | Emby 基础 URL。 |
| `EMBY_API_KEY` | — | Emby 密钥／令牌。 |
| `TMDB_KEY` | — | TMDB v3 或 v4 bearer/JWT。 |
| `KOMETA_ASSETS_DIR` | `./data/kometa`（Docker `/kometa`） | 未设置 config path 时 `posterpilot.yml` 的目录。 |
| `KOMETA_CONFIG_PATH` | — | `config.yml` 绝对路径；空值禁用管理器。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` 或 `own`。 |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Kometa 绑定的准确 Plex 实例。 |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`、`kometa` 或 `both`。 |
| `INCLUDED_SECTIONS` | 全部 | 逗号分隔的媒体库键；环境值覆盖各服务器选择。 |
| `PROVIDER_MEDIUX` | 开 | 启用 MediUX。 |
| `PROVIDER_TMDB` | 开 | 启用 TMDB 图片。 |
| `PROVIDER_FANART` | 关 | 启用 Fanart.tv。 |
| `PROVIDER_THEPOSTERDB` | 关 | 启用 ThePosterDB。 |
| `FANART_KEY` | — | Fanart.tv 密钥。 |
| `MEDIUX_REQUEST_DELAY_MS` | `2000` | MediUX 请求间隔（毫秒）。 |
| `MEDIUX_CONCURRENCY` | `5` | MediUX 并发数。 |
| `HTTP_CACHE_TTL_DAYS` | `7` | HTTP 缓存天数。 |
| `APPLY_CONCURRENCY` | `4` | 批量应用并发项目数。 |
| `SUGGEST_PRESELECT` | 开 | 计算并显示明确建议。 |
| `INCREMENTAL_SYNC` | 开 | 普通同步跳过未更改项目。 |
| `LIBRARY_DEFAULT_SORT` | `title` | `title`、`year`、`rating`、`runtime`、`recent`、`added`。 |
| `FUN_ENABLED` | 关 | 显示 FUN 工具。 |
| `THUMB_CACHE_TTL_DAYS` | `30` | 缩略图缓存有效天数。 |
| `THUMB_CACHE_MAX_MB` | `512` | 缩略图缓存上限 MB。 |
| `APP_LANGUAGE` | 自动 | `en`、`es`、`zh`、`ja`、`pt-BR`。 |
| `AUTH_MODE` | `disabled` | `disabled`、`local`、`enabled`；覆盖界面。 |
| `ADDRESS_HEADER` | — | 代理后的真实 IP 请求头。 |
| `XFF_DEPTH` | — | 可信代理数量。 |
| `MAX_UPLOAD_MB` | `15` | 图片上传大小上限。 |
| `LOG_DIR` | `./data/logs`（Docker `/data/logs`） | 轮转日志目录。 |
| `EVENT_RETENTION` | `2000` | 数据库活动记录上限。 |
| `DATABASE_URL` | `file:./data/posterpilot.db` | SQLite libsql URL。 |
| `PORT` | `3000` | HTTP 端口。 |
| `APP_SECRET` | — | 派生加密密钥，优先于 `.app-key`。 |
| `APP_KEY_FILE` | `./data/.app-key` | 自动生成密钥路径。 |

布尔值支持 `1`、`true`、`on`、`yes`（不区分大小写）。`DATABASE_URL`、`PORT`、`APP_SECRET`、`APP_KEY_FILE`、`ADDRESS_HEADER`、`XFF_DEPTH`、`MAX_UPLOAD_MB` 只能来自环境变量。

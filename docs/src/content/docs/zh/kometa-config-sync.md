---
title: Kometa 管理器
description: 通过精确预览与确认、脱敏 diff、原子写入和预览恢复来管理 config.yml。
---

除了[把海报导出为元数据](../usage/#kometa-如何使用导出)，PosterPilot 还能在 **`/kometa`** 管理 Kometa 的 `config.yml`。这是可选功能：未设置路径时不会读取或写入文件。

:::note[两个文件]
- **`posterpilot.yml`** 按 TMDB ID 保存 `url_poster` / `url_background`，应用到 Kometa 目的地时写入。
- **`config.yml`** 是 Kometa 自己的连接、媒体库、合集、覆盖层、操作和设置。

设置 `KOMETA_CONFIG_PATH` 后，`posterpilot.yml` 会写在 `config.yml` 同一目录并按文件名引用，不存在单独的元数据路径。
:::

## 启用与挂载

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | 空 | 已挂载 `config.yml` 的绝对路径；空值禁用管理器。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` 保留未管理内容；`own` 重新生成整个文件。 |
| `KOMETA_SERVER_INSTANCE_ID` | 旧版服务器 | 与 Kometa 绑定的命名 Plex 实例。 |

请把配置目录以可读写方式挂载到容器，参阅[安装](../installation/)。Kometa 仅适用于 Plex；Jellyfin／Emby 或隐式借用另一实例凭据会被拒绝。

## 管理范围

- Plex、TMDB、Tautulli、Trakt、MDBList、OMDb、GitHub、Radarr、Sonarr、Notifiarr、Gotify、ntfy、AniDB、MAL **连接**，密钥会隐藏。
- 含 `metadata_files`、`collection_files`、覆盖层、操作和局部设置的**媒体库**。
- 选定的全局**设置与 webhook**。
- 完整文件的 **Raw config.yml**。
- 每次写入创建的带时间戳**备份**。

`merge` 只修改受管键，保留其他键和注释。使用 YAML anchor／alias 的区域无法安全局部改写，会被跳过并警告。缺少 chart／overlay 所需连接时也会显示一致性警告。

## 结构化预览与确认

1. 保存路径、模式和 Plex 绑定。
2. 编辑要由 PosterPilot 管理的区域。
3. 选择**预览更改**。
4. 检查新增、修改、删除、警告和脱敏 diff。
5. 选择**确认已预览同步**。

计划会过期、只能使用一次，并绑定文件指纹、Plex 实例、模式和完整建议内容。更改任何输入都会使预览失效。陈旧、已改、过期或重复使用的计划不会写入任何内容。

## 原始编辑器

**预览原始更改**会先验证 YAML。解析错误就地显示，不会签发计划。**确认原始保存**是独立操作，只写入与预览绑定的文本。文本或磁盘文件变化后必须重新预览。

## 备份与恢复

每次确认写入都原子替换文件，并把旧版保存为 `config.yml.posterpilot-bak-<timestamp>`。恢复也先预览 diff，再单独确认。当前文件或备份变化会导致拒绝；替换前也会备份当前文件。

:::caution[明文密钥]
Kometa 要求 Plex 令牌和 TMDB 密钥以明文存在于 `config.yml`，因此磁盘备份也会包含。PosterPilot 会在界面和 diff 中隐藏它们，但无法加密 Kometa 要读取的文件。请保护卷和文件权限。
:::

参阅[安全、验证与撤销](../safety/)和[自动化与恢复](../automation-recovery/)。

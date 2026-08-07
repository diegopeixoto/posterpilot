---
title: Kometa 管理器
description: 通过精确预览与确认、脱敏 diff、原子写入和预览恢复来管理 config.yml。
---

除了[把海报导出为元数据](../usage/#kometa-如何使用导出)，PosterPilot 还能在 **`/kometa`** 管理 Kometa 的 `config.yml`。这是可选功能：未设置路径时不会读取或写入文件。

:::note[配置与元数据用途不同]
- **`posterpilot-movies.yml`** 保存 TMDB 命名空间中的电影图片；没有 TMDB ID 时回退到 IMDb。
- **`posterpilot-shows.yml`** 保存 TVDB 命名空间中的剧集、季和单集；没有 TVDB ID 时回退到 IMDb。命名空间由 PosterPilot 记录的媒体类型决定，绝不会根据数字键猜测。
- **`config.yml`** 是 Kometa 自己的连接、媒体库、合集、覆盖层、操作和设置。
:::

## 启用与挂载

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `KOMETA_CONFIG_PATH` | 空 | 已挂载 `config.yml` 的绝对路径；空值禁用管理器。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` 保留未管理内容；`own` 重新生成整个文件。 |
| `KOMETA_SERVER_INSTANCE_ID` | 旧版服务器 | 与 Kometa 绑定的命名 Plex 实例。 |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Kometa 运行时可见的相对目录；使用 `.`（或清空 UI 字段）可仅使用文件名。 |

请把配置目录以可读写方式挂载到容器，参阅[安装](../installation/)。Kometa 仅适用于 Plex；Jellyfin／Emby 或隐式借用另一实例凭据会被拒绝。

物理输出路径与 Kometa 引用是两个概念。PosterPilot 把两个文件并排写入配置的输出目录，而 `file:` 必须从 **Kometa 运行时视角**指向同一文件。默认引用为 `config/posterpilot-movies.yml` 和 `config/posterpilot-shows.yml`，即使使用另一挂载名称把文件实际放在 `config.yml` 旁边也是如此。该值是相对前缀，不应填写主机路径、容器绝对路径、URL 或 YAML 文件名。

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

## 迁移旧版 posterpilot.yml

:::caution[等待正式版本]
不要手工重命名、拆分或重新连接 `posterpilot.yml`。请等待包含此迁移的 PosterPilot 版本发布到 [Releases](https://github.com/diegopeixoto/posterpilot/releases)，升级实例后再使用 `/kometa` 中显示的迁移。
:::

旧安装可能把电影和剧集混在单个 `posterpilot.yml` 中，仿佛共用 TMDB 命名空间。迁移会进行规范化：

1. **预览。** PosterPilot 将旧文件与绑定的 Plex 媒体库及精确修订历史核对。预览只显示结构、指纹和数量，不显示图片 URL 或凭据。电影使用 TMDB，没有时回退到 IMDb；剧集使用 TVDB，没有时也回退到 IMDb。
2. **歧义。** 数字键可能在媒体类型间冲突，因此 PosterPilot 不会猜测。没有证据的条目会单独列出。你可以修正匹配，或者明确接受歧义、完成迁移后在 PosterPilot 中重新应用图片；重新应用会写入正确的分类文件。已存在且冲突的分类条目也不会被覆盖。
3. **确认。** 系统先保存持久迁移日志和受保护备份，再写入并验证**两个**分类文件，最后才修改 `config.yml`。旧版 `posterpilot.yml` 永远不会被修改或删除。
4. **重试／恢复。** 中断后重试会从已验证检查点继续，不重新分类。如果文件既不符合预览指纹，也不符合已写入结果，操作会停止并要求重新检查，而不会覆盖文件。

如果 PosterPilot 能安全证明自己管理相关 `metadata_files`，就会自动更新 `config.yml`。否则它会写好分类文件并提供按媒体库划分的准确参考指南。**不要用这个不完整的 `libraries:` 块覆盖现有配置。** 在每个列出的媒体库中，如果存在 `file` basename 为 `posterpilot.yml` 的 `metadata_files` 项，只替换该项；如果不存在，则只添加一次所示分类项。保留所有同级项和媒体库设置，最终确保分类引用恰好一个且旧引用不再生效。从 Kometa 运行时视角核对路径后，再在 PosterPilot 中确认完成。该确认只记录你的声明，并不表示 PosterPilot 验证过手工编辑。

**Rollback** 仅在当前配置仍与迁移结果完全一致时恢复受保护的迁移前 `config.yml`。分类文件和旧文件会保留，因此生成的图片不会丢失，后续重试也无需重新构建。

## 原始编辑器

**预览原始更改**会先验证 YAML。解析错误就地显示，不会签发计划。**确认原始保存**是独立操作，只写入与预览绑定的文本。文本或磁盘文件变化后必须重新预览。

## 备份与恢复

每次确认写入都原子替换文件，并把旧版保存为 `config.yml.posterpilot-bak-<timestamp>`。恢复也先预览 diff，再单独确认。当前文件或备份变化会导致拒绝；替换前也会备份当前文件。

:::caution[明文密钥]
Kometa 要求 Plex 令牌和 TMDB 密钥以明文存在于 `config.yml`，因此磁盘备份也会包含。PosterPilot 会在界面和 diff 中隐藏它们，但无法加密 Kometa 要读取的文件。请保护卷和文件权限。
:::

参阅[安全、验证与撤销](../safety/)和[自动化与恢复](../automation-recovery/)。

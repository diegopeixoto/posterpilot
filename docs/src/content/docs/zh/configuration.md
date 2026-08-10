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

- **Plex**：手动令牌，或设置向导中的 PIN 登录／连接发现。
- **Jellyfin／Emby**：URL 与密钥／令牌；向导也能把用户名密码换成可重用令牌，密码不会保存。

## TMDB、提供方与评分

`TMDB_KEY` 支持 v3 密钥或 v4 bearer/JWT。MediUX 与 TMDB 默认启用；Fanart.tv 需要 `FANART_KEY`；ThePosterDB 可选。一个提供方失败不会阻止其他提供方，并可保留已知候选标记为陈旧。

ThePosterDB 无需账号即可使用，但它在部分页面会向匿名访问返回占位图而非真实海报。可**选择**登录以获取真实图片：在**元数据与提供方**中填写（启用 ThePosterDB 后显示字段），或设置 `THEPOSTERDB_USERNAME` / `THEPOSTERDB_PASSWORD`。密码与其他密钥一样在静态时加密保存；登录失败时该次运行会回退到匿名抓取，不会阻断发现。要恢复匿名抓取，请清空用户名（登录需要两者齐全）；已保存的密码仍加密保存在数据库中，重新填入用户名后会再次使用——如需删除，请使用密码字段下方的**清除已保存的密码**控件，保存后即会移除该密钥。

![PosterPilot 提供方设置，已启用 ThePosterDB 并显示可选的用户名和密码字段](/posterpilot/screenshots/settings-providers.webp)

在**元数据与提供方**中还可以**重新排序**这四个提供方——拖动手柄或使用移动按钮，**恢复默认顺序**会还原为 MediUX、ThePosterDB、Fanart.tv、TMDB。这个控件之所以存在，是因为发现会并行运行所有提供方、各自提交结果，候选存下来的先后顺序只记录了哪个提供方先响应；把这种时序上的偶然当成排名会误导人，所以项目视图改为遵循你配置的顺序。这个顺序决定**项目页先显示哪个提供方的卡片**（只是展示，卡片内部的候选保持自身顺序），并在得分**完全相同**的候选之间充当决胜条件，严格排在数值得分之后；它绝不会推翻不相等的得分——你排在最后的提供方给出更清晰或比例更合适的图片，仍然会赢得建议，提供方是决胜条件而不是覆盖手段。**被禁用的提供方保留原位**，重新启用不会把它挤到最后；你保存的顺序里没有提到的提供方（新加入的来源，或某个被移除来源留下的行）会显示在最后，而不是把其余顺序全部打乱。

要改变通常哪个提供方胜出，请调整评分权重而不是顺序：在**元数据与提供方**中可以调整提供方、分辨率与宽高比权重。与顺序一样，权重保存在数据库中，没有对应的环境变量。预览与执行使用同一确定性配置。`SUGGEST_PRESELECT` 显示最佳建议，但接受／暂存始终需要明确操作。

## TMDB 图片语言

`TMDB_ARTWORK_LANGUAGE`（默认 `any`）决定浏览和自动选择哪些语言的 TMDB 图片，且与 `APP_LANGUAGE` 相互独立：`any` 保留 TMDB 返回的全部语言；`ui` 跟随界面语言并归一化为基础代码（`pt-BR` 界面偏好 `pt`），若解析不出界面语言——例如在从未保存过语言设置的实例上运行的无人值守任务——则退回 `any`，而不是凭空编一个语言；也可以直接写 ISO 639-1 基础代码（`en`、`de` 等），不限于已翻译的六种界面语言，因为 TMDB 标注图片的语言远多于 PosterPilot 的翻译语言。设置里的下拉框提供精选的十种（德语、英语、西班牙语、法语、意大利语、日语、韩语、葡萄牙语、俄语、中文）；通过环境变量设置、又不在这份名单上的代码会被加进下拉框而不是丢弃，因此保存设置绝不会悄悄改写它。无法识别的值按未设置处理并回退到 `any`，而不会套用错误的筛选——一个拼写错误不该清空你的候选网格。与其他设置一样，环境变量优先，界面中该字段显示为环境管理。

设置之前有四点值得知道。**它只管 TMDB，不管别的**：其他提供方的图片在任何偏好下都保持可选，这是规则而不是权宜之计。MediUX 和 ThePosterDB 根本不报告语言，把“没有语言”当作不合格，会在你设置任何偏好的那一刻清空它们的网格，而且重新搜索也救不回来，因为它还是会报告没有语言；Fanart.tv **确实**标注语言，但同样不受影响，因为按这个设置本来就无意管辖的信号去筛选它，会悄悄丢掉一个得分更高的资源。**无字图片始终保留**：TMDB 明确标注为不含语言的图片算作语言中性，在任何偏好下都保留，因此偏好绝不会清空只有中性图片的面板。**发现始终保留全部**：偏好只影响浏览与自动选择，不影响下载内容，TMDB 返回的每一种语言都会存下来，所以更改偏好只是重新筛选已有候选，无需重新搜索。**自动选择保持诚实**：仅当既没有偏好语言、也没有未标注语言的候选时，自动选择才会退回其他语言的海报，并在这种情况下加以标注；已暂存的这种回退结果会继续显示在页面上，而不会被产生它的那个偏好筛掉——你必须能看见的选择，也必须能撤销。

有一种情况应用自己回答不了。在 PosterPilot 开始记录“它是怎么得知语言的”之前发现的 TMDB 候选会带上**未验证**标记：意思是**我们从未记录过这条信息**，而不是“TMDB 说它没有文字”——后者是另一种状态。这些候选会保留而不是隐藏——一设置偏好就把整个媒体库升级前的 TMDB 清单全部降级只会更糟——提供方分组提供**重新搜索**，让新的一次运行记录下真正的标注。

项目页带有**显示所有语言**开关（以及切回用的“**仅显示〈语言〉**”），可以在单个标题上越过偏好查看，而不改动全局设置。偏好在某个标题上没有任何匹配时，页面会说明其他语言里有多少封面并给出同样的出口，而不是显示一个空网格。

## 候选清单与“加载更多”

TMDB 采集过去**按图片类型**各截取 20 张——海报与背景图分别计数，这正是“上限 40 张封面”反馈的由来。现在会保留远多于此的候选：先校验、再按 TMDB 自身的文件标识去重、最后才截断，严格按这个顺序，因此一个格式错误的条目不会再悄悄吃掉一个候选名额；并保持 TMDB 给出的排序。

项目页随后按 **24 张**一批显示每个面板，**加载更多**控件会说明还有多少仍被隐藏。24 能整除页面渲染的每一种网格（背景两列、标题卡四列、季海报八列），所以每次展开都不会留下参差的半行。每个面板**各自独立**展开——逐个提供方、逐个套装，海报与背景分开，每一季的海报与它的标题卡也分开——所以展开一个绝不会连带展开另一个。展开不产生任何网络流量：保留下来的清单本来就随页面一起送达，因此这里约束的是渲染开销，而不是带宽。

采集仍保留**每种图片类型 200 个候选**的防御性上限，好让一个异常标题无法拉进无限多的图片。这是存储与渲染的边界，而非质量筛选——而且触到上限会被明确报告，不会默默略过：面板会说该提供方返回的封面超过 PosterPilot 保留的数量，而不是暗示你看到的就是 TMDB 的全部。只有本来会被保留的候选才计入这个上限；被丢弃的重复项和格式错误的条目不计入，因为它们本来就不是你可以挑选的东西。

缩略图缓存（`THUMB_CACHE_TTL_DAYS`、`THUMB_CACHE_MAX_MB`）只保存**浏览用的预览图**：放大后的原尺寸预览以及真正被应用的资源都刻意直接从提供方获取，这样原图就不会挤掉这个缓存本该提供的缩略图。参阅[使用](../usage/)里的“浏览时实际下载了什么”。

## Kometa 与应用方式

`DEFAULT_APPLY_METHOD` 可为 `plex`（直接服务器）、`kometa` 或 `both`。单次操作切换不会修改已保存默认值。

导出把 `posterpilot-movies.yml`（TMDB）和 `posterpilot-shows.yml`（TVDB，没有时回退 IMDb）写入 `KOMETA_ASSETS_DIR`；设置 `KOMETA_CONFIG_PATH` 后会与 `config.yml` 同目录。`KOMETA_SERVER_INSTANCE_ID` 必须指向准确的 Plex 实例；`KOMETA_METADATA_PATH_PREFIX` 指定 Kometa 可见的相对引用，而非物理路径。参阅 [Kometa 管理器](../kometa-config-sync/)。

## 自动化、备份与诊断

- **自动化**：按服务器／媒体库设置间隔、每天时间或事件；同步／发现到 Review，绝不自动应用。
- **备份与恢复**：`/data/backups` 下的包、按数量／天数保留、验证、导出和预览恢复。保留策略保存在应用内，没有环境变量。
- **诊断**：无修改检查服务器、TMDB、提供方和路径，并在明确操作后导出脱敏支持包。

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
| `KOMETA_ASSETS_DIR` | `./data/kometa`（Docker `/kometa`） | 未设置 config path 时分类 YAML 的目录。 |
| `KOMETA_CONFIG_PATH` | — | `config.yml` 绝对路径；空值禁用管理器。 |
| `KOMETA_CONFIG_MODE` | `merge` | `merge` 或 `own`。 |
| `KOMETA_SERVER_INSTANCE_ID` | `legacy-default` | Kometa 绑定的准确 Plex 实例。 |
| `KOMETA_METADATA_PATH_PREFIX` | `config` | Kometa 运行时可见的相对目录；`.` 仅使用文件名。 |
| `DEFAULT_APPLY_METHOD` | `both` | `plex`、`kometa` 或 `both`。 |
| `INCLUDED_SECTIONS` | 全部 | 逗号分隔的媒体库键；环境值覆盖各服务器选择。 |
| `PROVIDER_MEDIUX` | 开 | 启用 MediUX。 |
| `PROVIDER_TMDB` | 开 | 启用 TMDB 图片。 |
| `PROVIDER_FANART` | 关 | 启用 Fanart.tv。 |
| `PROVIDER_THEPOSTERDB` | 关 | 启用 ThePosterDB。 |
| `FANART_KEY` | — | Fanart.tv 密钥。 |
| `THEPOSTERDB_USERNAME` | — | 可选的 ThePosterDB 账号用户名或邮箱，用于登录抓取。 |
| `THEPOSTERDB_PASSWORD` | — | 可选 ThePosterDB 账号的密码（密钥，加密保存）。 |
| `TMDB_ARTWORK_LANGUAGE` | `any` | 浏览与自动选择的 TMDB 图片语言：`any`、`ui`（跟随界面语言）或 `en` 之类的 ISO 639-1 基础代码；无效值回退到 `any`。 |
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
| `APP_LANGUAGE` | 自动 | `en`、`es`、`zh`、`ja`、`pt-BR`、`fr`。 |
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

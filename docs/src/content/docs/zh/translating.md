---
title: 翻译
description: 通过 Weblate 帮助将 PosterPilot 界面翻译成你的语言——无需任何编码。
---

帮助将界面翻译成你的语言！无需任何编码。本页镜像了
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md#translators)
的 Translators 部分。

界面已本地化为英语（默认）、西班牙语、简体中文、
日语和巴西葡萄牙语，并带有 **按键的英语回退**，因此任何
未翻译的字符串始终会显示可读的英语——绝不会显示原始键。

## 真实来源

每个面向用户的字符串都位于 `messages/` 下的、按区域设置划分的 JSON 目录中——
每种语言一个文件，以稳定的消息 id 为键：

- `messages/en.json` — 完整的 **源** 目录（每一个消息 id）
- `messages/es.json` — 西班牙语
- `messages/zh.json` — 简体中文
- `messages/ja.json` — 日语
- `messages/pt-BR.json` — 巴西葡萄牙语

其他目录保存翻译，且可能不完整。在目标区域设置中缺失或
留空的任何 id 都会回退到其英语文本。添加到 `en.json` 的新英语字符串
会自动作为未翻译条目出现在每种语言中。

## 通过 Weblate（推荐）

翻译通过 [Weblate](https://hosted.weblate.org/engage/posterpilot/) 管理，
这是一个自由的 Web 翻译平台，采用基于 git 的工作流程：

1. 打开 [Weblate 上的 PosterPilot 项目](https://hosted.weblate.org/engage/posterpilot/)
   并登录——免费账户即可。
2. 选择你的语言，并直接在浏览器中翻译未翻译的字符串。
3. Weblate 会通过 git 将更改作为提交/PR 提议回仓库；由
   维护者合并它们。

[![Translation status](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

Weblate 组件配置为针对 `messages/*.json`，以 `en` 作为
源语言，采用 JSON（键值）格式，因此它始终反映当前的
源目录。

## 通过直接拉取请求

你也可以手动编辑目录：将一个新键从 `messages/en.json` 复制到
`messages/<locale>.json`，翻译其值，然后打开一个 PR。

- 保持键与源完全一致；只翻译 **值**。
- 不要翻译技术专有名词：**Plex、MediUX、TMDB、Kometa、
  Fanart.tv**。

## 如何选择活动语言

活动语言按请求解析：(1) 你持久化的首选项（通过
页眉切换器或设置设定），然后 (2) 你浏览器的 `Accept-Language`，然后
(3) 英语。详情参见 [配置 → 语言](/posterpilot/zh/configuration/)。

通过贡献翻译，你同意你的贡献依据项目的
[MIT license](https://github.com/diegopeixoto/posterpilot/blob/main/LICENSE) 授权。

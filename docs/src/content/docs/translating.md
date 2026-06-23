---
title: Translating
description: Help translate the PosterPilot UI into your language through Weblate — no coding required.
---

Help translate the UI into your language! No coding is required. This page mirrors
the Translators section of
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md#translators).

The UI is localized into English (the default), Spanish, Simplified Chinese,
Japanese, and Brazilian Portuguese, with **per-key English fallback** so any
string left untranslated always shows readable English — never a raw key.

## Source of truth

Every user-facing string lives in a per-locale JSON catalog under `messages/` —
one file per language, keyed by a stable message id:

- `messages/en.json` — the complete **source** catalog (every message id)
- `messages/es.json` — Spanish
- `messages/zh.json` — Simplified Chinese
- `messages/ja.json` — Japanese
- `messages/pt-BR.json` — Brazilian Portuguese

The other catalogs hold translations and may be partial. Any id missing or left
empty in a target locale falls back to its English text. New English strings added
to `en.json` automatically surface as untranslated entries for every language.

## Via Weblate (recommended)

Translations are managed through [Weblate](https://hosted.weblate.org/engage/posterpilot/),
a libre web translation platform, using a git-based workflow:

1. Open the [PosterPilot project on Weblate](https://hosted.weblate.org/engage/posterpilot/)
   and sign in — a free account works.
2. Pick your language and translate the untranslated strings right in the browser.
3. Weblate proposes the changes back to the repository as commits/PRs over git; a
   maintainer merges them.

[![Translation status](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

The Weblate component is configured against `messages/*.json` with `en` as the
source language and JSON (key-value) format, so it always reflects the current
source catalog.

## Via a direct pull request

You can also edit a catalog by hand: copy a new key from `messages/en.json` into
`messages/<locale>.json`, translate the value, and open a PR.

- Keep keys identical to the source; only translate the **values**.
- Leave technical proper nouns untranslated: **Plex, MediUX, TMDB, Kometa,
  Fanart.tv**.

## How the active language is chosen

The active language is resolved per request: (1) your persisted preference (set
via the header switcher or Settings), then (2) your browser's `Accept-Language`,
then (3) English. See [Configuration → Language](/posterpilot/configuration/#language)
for details.

By contributing translations, you agree your contributions are licensed under the
project's [MIT license](https://github.com/diegopeixoto/posterpilot/blob/main/LICENSE).

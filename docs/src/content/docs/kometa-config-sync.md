---
title: Kometa config sync
description: Let PosterPilot surgically manage Kometa's own config.yml — Plex/TMDB connections, libraries, default collection sets, and a bounded set of settings and webhooks — with a preview diff, atomic writes, and timestamped backups.
---

Beyond [exporting artwork as a metadata file](/posterpilot/usage/#how-kometa-consumes-the-export),
PosterPilot can manage **Kometa's own `config.yml`** for you. It reads your
existing config, updates only the sections it owns, and writes the file back —
preserving every other key and comment untouched.

This is opt-in and off by default: until you point PosterPilot at a `config.yml`,
nothing about your Kometa config is read or written.

:::note[Two Kometa files, two jobs]
PosterPilot touches two different files, and they are easy to confuse:

- **`posterpilot.yml`** — the _metadata_ file PosterPilot already writes when you
  apply a cover with the Kometa method. It holds `url_poster` / `url_background`
  entries keyed by TMDB id. See [Apply a cover](/posterpilot/usage/#apply-a-cover).
- **`config.yml`** — Kometa's _own_ top-level configuration: connections,
  libraries, collection files, and settings. This is the file the **Kometa config
  sync** feature on this page manages.

Config sync wires the first file _into_ the second, so Kometa knows to read
`posterpilot.yml`.
:::

## Turn it on

Config sync is controlled by two settings, both of which follow the same
[environment-overrides-UI precedence](/posterpilot/configuration/#environment-vs-the-settings-ui)
as the rest of PosterPilot:

| Variable               | Setting             | Default                                  | Meaning                                                                                                                          |
| ---------------------- | ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `KOMETA_CONFIG_PATH`   | Kometa config path  | —                                        | Absolute path to Kometa's `config.yml`. **Empty or unset turns config sync off.**                                              |
| `KOMETA_METADATA_PATH` | Kometa metadata path | the Kometa assets dir (`KOMETA_ASSETS_DIR`) | The path at which **Kometa** sees PosterPilot's `posterpilot.yml`. Override it only when PosterPilot and Kometa mount that folder at different paths. |

`KOMETA_METADATA_PATH` exists because PosterPilot and Kometa can mount the same
shared folder at different locations. PosterPilot writes `posterpilot.yml` into
`KOMETA_ASSETS_DIR`; the value wired into `config.yml` has to be the path _Kometa_
uses to reach that same file. When both see the folder at the same path, the
default is correct and you can leave it blank.

To use config sync, Kometa's config directory must also be mounted into the
PosterPilot container with read/write access — see
[Mount Kometa's config for config sync](/posterpilot/installation/#mount-kometas-config-for-config-sync).

## The Kometa config tab

The workflow lives under **Settings → Kometa config**:

1. **Set the path.** Enter the path to Kometa's `config.yml` (or set
   `KOMETA_CONFIG_PATH`). PosterPilot reads the existing file so the rest of the
   tab reflects what is already there.
2. **Pick managed libraries.** Choose which of your libraries PosterPilot should
   own in `config.yml`. Libraries you do not select are left exactly as they are.
3. **Toggle default collection sets.** For each managed library, enable or disable
   Kometa's built-in default collection sets (its _categories_) — these become the
   library's `collection_files`.
4. **Optionally manage global settings and webhooks.** Flip on a small, bounded
   set of `settings:` and `webhooks:` keys if you want PosterPilot to keep them in
   sync too.
5. **Preview the diff.** PosterPilot shows you exactly what it would change before
   touching the file.
6. **Sync.** Approve the diff to write `config.yml`.

## What gets synced

PosterPilot only ever writes the sections it owns:

- **`plex:` and `tmdb:` connections** — built from PosterPilot's stored Plex base
  URL and token and your TMDB key. Kometa is Plex-only, so config sync targets a
  Plex server.
- **The `libraries:` section** — each managed library, with `posterpilot.yml`
  wired in under its `metadata_files` so Kometa applies the covers you exported.
- **Per-library `collection_files`** — the default collection sets you toggled for
  each library.
- **A bounded set of `settings:` and `webhooks:` keys** — only the specific keys
  PosterPilot manages, never the whole block.

Everything else in `config.yml` is left alone.

## Safety

Config sync is built to be non-destructive:

- **Surgical merge.** PosterPilot updates only the keys it owns and preserves all
  other content — including your comments and unmanaged sections — leaving the
  rest of the file untouched.
- **Preview before write.** A diff is always shown first; nothing is written until
  you approve it.
- **Atomic writes with a backup.** The new file is written atomically, and the
  previous version is kept beside it as `config.yml.posterpilot-bak-<timestamp>`,
  so you can always roll back.
- **Anchors and aliases are skipped.** Any section that uses YAML anchors or
  aliases (`&` / `*`) is left untouched and flagged with a warning, because a
  surgical merge cannot safely rewrite them.

:::caution[Kometa needs your secrets in plaintext]
Kometa reads the Plex token and TMDB key from `config.yml` in plaintext, so
PosterPilot **writes them into `config.yml` — and into every
`config.yml.posterpilot-bak-<timestamp>` backup — on disk.** Make sure that file
and its backups live on storage you trust, with appropriate filesystem
permissions. This is a property of how Kometa is configured, not something
PosterPilot can work around.
:::

---
title: Kometa manager
description: A dedicated /kometa page that manages Kometa's own config.yml end to end — every service connector, per-library collections, overlays and operations, global settings and webhooks, plus a raw config.yml editor — with a preview diff, atomic writes, timestamped backups, and one-click restore.
---

Beyond [exporting artwork as a metadata file](/posterpilot/usage/#how-kometa-consumes-the-export),
PosterPilot can manage **Kometa's own `config.yml`** for you — not just a couple of
sections, but the whole file. It reads your existing config, updates only the
parts it owns, and writes the file back, preserving every other key and comment
untouched.

This lives on its own top-level page, **`/kometa`** (the **Kometa** item in the
main nav), not in Settings. It is opt-in and off by default: until you point
PosterPilot at a `config.yml`, nothing about your Kometa config is read or written.

:::note[Two Kometa files, two jobs]
PosterPilot touches two different files, and they are easy to confuse:

- **`posterpilot.yml`** — the _metadata_ file PosterPilot writes when you apply a
  cover with the Kometa method. It holds `url_poster` / `url_background` entries
  keyed by TMDB id. See [Apply a cover](/posterpilot/usage/#apply-a-cover).
- **`config.yml`** — Kometa's _own_ top-level configuration: connections,
  libraries, collection files, overlays, operations, and settings. This is the
  file the **Kometa manager** on this page manages.

The manager wires the first file _into_ the second, so Kometa knows to read
`posterpilot.yml`. PosterPilot writes `posterpilot.yml` into the **same directory
as `config.yml`**, and the `metadata_files` entry references it by its bare
basename (`posterpilot.yml`) — so there is exactly one file and the wiring always
matches. No separate metadata path or mount is involved.
:::

## Turn it on

The Kometa manager is controlled by two settings, both of which follow the same
[environment-overrides-UI precedence](/posterpilot/configuration/#environment-vs-the-settings-ui)
as the rest of PosterPilot:

| Variable             | Setting            | Default | Meaning                                                                                                                |
| -------------------- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `KOMETA_CONFIG_PATH` | Kometa config path | —       | Absolute path to Kometa's `config.yml`. **Empty or unset turns the Kometa manager off.**                              |
| `KOMETA_CONFIG_MODE` | Kometa config mode | `merge` | `merge` (surgical — preserves your other keys and comments) or `own` (PosterPilot regenerates and fully owns the file). |

To use the manager, Kometa's config directory must also be mounted into the
PosterPilot container with read/write access — see
[Mount Kometa's config](/posterpilot/installation/#mount-kometas-config-for-config-sync).
Because `posterpilot.yml` is co-located with `config.yml`, that one directory is
all you need; there is no separate metadata mount.

## The /kometa page

The manager opens on a **cinematic spotlight hero** — an image-forward backdrop
banner with the manager title and live status (config path, mode, last sync,
managed-library count) overlaid — so a config-heavy surface still carries the
app's "artwork is the hero" identity. The config-path and mode controls, plus the
**Preview** and **Sync** actions, live in the header beneath it.

Below the hero, the page is organized into sub-sections:

1. **Connections** — structured forms for every Kometa service connector (see
   [What gets managed](#what-gets-managed)). Secrets are masked, and a connection
   test is offered where it makes sense.
2. **Libraries** — for each library you choose to manage: its collection files,
   overlay defaults, operations, per-library settings overrides, and the
   `posterpilot.yml` metadata wiring. Libraries you do not select are left exactly
   as they are.
3. **Settings & webhooks** — a bounded set of global `settings:` and `webhooks:`
   keys you can opt to keep in sync.
4. **Raw config.yml** — a full-file editor for anything not covered by a form, with
   the same safety as the structured path (parse-validate → diff → save).
5. **Backups** — list the timestamped backups PosterPilot writes on each save and
   **restore** any one of them.

The usual flow is: set the path, fill in the sections you want PosterPilot to own,
**Preview** the diff to see exactly what would change, then **Sync** to write
`config.yml`.

## What gets managed

PosterPilot only ever writes the sections it owns; everything else in `config.yml`
is left alone.

- **Service connectors** — structured forms for `plex`, `tmdb`, `tautulli`,
  `trakt`, `mdblist`, `omdb`, `github`, `radarr`, `sonarr`, `notifiarr`, `gotify`,
  `ntfy`, `anidb`, and `mal`. The `plex` and `tmdb` blocks are pre-filled from
  PosterPilot's stored Plex base URL and token and your TMDB key. Kometa is
  Plex-only, so the manager targets a Plex server.
- **The `libraries:` section** — each managed library, with `posterpilot.yml`
  wired in under its `metadata_files` (as the co-located basename) so Kometa
  applies the covers you exported.
- **Per-library `collection_files`** — the default collection sets you toggle for
  each library.
- **Per-library `overlay_files`** — overlay defaults such as `mediastinger`,
  `resolution`, `ribbon`, `audio_codec`, `network`, and `ratings`.
- **Per-library `operations`** — toggles such as `mass_*`, `remove_overlays`,
  `delete_collections`, and `assets_for_all`.
- **Per-library `settings` overrides** — the small set of overrides PosterPilot
  surfaces for a managed library.
- **Global `settings:` and `webhooks:` keys** — only the specific keys PosterPilot
  manages, never the whole block.
- **Anything else, via the raw editor** — the [raw `config.yml` editor](#the-kometa-page)
  is the backstop, so nothing in your config is unmanageable.

### Consistency check

Before it writes, PosterPilot runs a **consistency check** and warns when an
enabled chart or overlay needs a connector you have not configured — for example a
`trakt` or `tautulli` chart, or a ratings overlay, with no matching `trakt:` /
`tautulli:` block. The warning is non-blocking (it lists the missing connector
alongside any anchor/alias warnings in the preview); fix the connector or proceed
as you see fit.

## Safety

The Kometa manager is built to be non-destructive:

- **Surgical merge (default).** In `merge` mode PosterPilot updates only the keys
  it owns and preserves all other content — your comments and unmanaged sections
  included. Deselecting a managed item removes only PosterPilot's entry, never your
  content. (`own` mode, opt-in via `KOMETA_CONFIG_MODE=own`, lets PosterPilot
  regenerate and fully own the file.)
- **Preview before write.** A diff is always shown first; nothing is written until
  you approve it. Secrets are redacted in the diff.
- **Atomic writes with a backup.** The new file is written atomically, and the
  previous version is kept beside it as `config.yml.posterpilot-bak-<timestamp>`.
- **Backups & restore.** The **Backups** section lists those timestamped backups
  and lets you **restore** any one of them — the restore is itself written
  atomically and backed up first, so it is just as safe as a normal sync.
- **Anchors and aliases are skipped.** Any section that uses YAML anchors or
  aliases (`&` / `*`) is left untouched and flagged with a warning, because a
  surgical merge cannot safely rewrite them.

:::caution[Kometa needs your secrets in plaintext]
Kometa reads the Plex token and TMDB key from `config.yml` in plaintext, so
PosterPilot **writes them into `config.yml` — and into every
`config.yml.posterpilot-bak-<timestamp>` backup — on disk.** PosterPilot masks
them in the UI and redacts them from the preview diff, but they still land on the
mounted volume. Make sure that file and its backups live on storage you trust,
with appropriate filesystem permissions. This is a property of how Kometa is
configured, not something PosterPilot can work around.
:::

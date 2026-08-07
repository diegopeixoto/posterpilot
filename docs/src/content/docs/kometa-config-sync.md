---
title: Kometa manager
description: Manage Kometa config.yml through exact preview and confirmation, redacted diffs, atomic writes, timestamped backups, and previewed restore.
---

Beyond [exporting artwork as a metadata file](/posterpilot/usage/#how-kometa-consumes-the-export),
PosterPilot can manage **Kometa's own `config.yml`** for you — not just a couple of
sections, but the whole file. It reads your existing config, updates only the
parts it owns, and writes the file back, preserving every other key and comment
untouched.

This lives on its own top-level page, **`/kometa`** (the **Kometa** item in the
main nav), not in Settings. It is opt-in and off by default: until you point
PosterPilot at a `config.yml`, nothing about your Kometa config is read or written.

:::note[Configuration and metadata have different jobs]
PosterPilot touches Kometa's configuration plus two generated metadata files:

- **`posterpilot-movies.yml`** — movie artwork, keyed by TMDB id with IMDb as the
  fallback when no TMDB id is available.
- **`posterpilot-shows.yml`** — show, season, and episode artwork, keyed by TVDB
  id with IMDb as the fallback when no TVDB id is available. The media type in
  PosterPilot decides the namespace; a numeric YAML key is never used to guess it.
- **`config.yml`** — Kometa's _own_ top-level configuration: connections,
  libraries, collection files, overlays, operations, and settings. This is the
  file the **Kometa manager** on this page manages.

See [Apply a cover](/posterpilot/usage/#apply-a-cover) for how those metadata
files are populated.
:::

## Turn it on

The Kometa manager is controlled by two settings, both of which follow the same
[environment-overrides-UI precedence](/posterpilot/configuration/#environment-vs-the-settings-ui)
as the rest of PosterPilot:

| Variable                      | Setting                    | Default  | Meaning                                                                                                                |
| ----------------------------- | -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `KOMETA_CONFIG_PATH`          | Kometa config path         | —        | Absolute path to Kometa's `config.yml`. **Empty or unset turns the Kometa manager off.**                              |
| `KOMETA_CONFIG_MODE`          | Kometa config mode         | `merge`  | `merge` (surgical — preserves your other keys and comments) or `own` (PosterPilot regenerates and fully owns the file). |
| `KOMETA_METADATA_PATH_PREFIX` | Metadata reference prefix | `config` | Relative directory Kometa sees at runtime. Use `.` (or clear the UI field) for bare filenames.                          |

To use the manager, the output directory and Kometa's config must be available to
the PosterPilot container with read/write access — see
[Mount Kometa's config](/posterpilot/installation/#mount-kometas-config-for-config-sync).

The physical output path and the value in Kometa's `file:` entry are deliberately
separate. PosterPilot writes `posterpilot-movies.yml` and
`posterpilot-shows.yml` beside each other in its configured output directory. The
`file:` entries must instead describe the same files from **Kometa's runtime
view**. With the default prefix they are
`config/posterpilot-movies.yml` and `config/posterpilot-shows.yml`, even when the
files are physically co-located with `config.yml` through a differently named
container mount. Set the prefix to `.` only when Kometa resolves bare basenames
from the correct directory. It is a relative reference prefix, not a host path,
container path, URL, or YAML filename.

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
   typed movie/show metadata wiring. Libraries you do not select are left exactly
   as they are.
3. **Settings & webhooks** — a bounded set of global `settings:` and `webhooks:`
   keys you can opt to keep in sync.
4. **Raw config.yml** — a full-file editor for anything not covered by a form, with
   the same safety as the structured path (parse-validate → diff → save).
5. **Backups** — list the timestamped backups PosterPilot writes on each save and
   **restore** any one of them.

The usual flow is: set and save the path/binding, fill in the sections you want
PosterPilot to own, **Preview changes**, then **Confirm previewed sync**. The
confirmation is enabled only for the currently visible preview.

## What gets managed

PosterPilot only ever writes the sections it owns; everything else in `config.yml`
is left alone.

- **Service connectors** — structured forms for `plex`, `tmdb`, `tautulli`,
  `trakt`, `mdblist`, `omdb`, `github`, `radarr`, `sonarr`, `notifiarr`, `gotify`,
  `ntfy`, `anidb`, and `mal`. The `plex` and `tmdb` blocks are pre-filled from
  PosterPilot's stored Plex base URL and token and your TMDB key. Kometa is
  Plex-only, so the manager targets a Plex server.
- **The `libraries:` section** — each managed library, with the matching
  `posterpilot-movies.yml` or `posterpilot-shows.yml` reference wired under its
  `metadata_files` so Kometa applies the covers you exported.
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

## Migrate from posterpilot.yml

:::caution[Wait for the release]
Do not rename, split, or rewire `posterpilot.yml` by hand. Wait until the
PosterPilot release containing this migration is published on the
[Releases page](https://github.com/diegopeixoto/posterpilot/releases), upgrade
your PosterPilot instance, and then use the migration shown on `/kometa`.
:::

Existing installations may have one legacy `posterpilot.yml` where both movies
and shows were keyed as though they shared the TMDB namespace. The migration
normalizes that file into the two typed destinations described above.

1. **Preview.** PosterPilot reads the legacy file, the bound Plex library, and its
   own exact revision history. The preview shows structural fingerprints and
   destination counts, not artwork URLs or credentials. Movies use TMDB and fall
   back to IMDb; shows use TVDB and fall back to IMDb.
2. **Resolve ambiguity.** A numeric legacy key can collide across media types, so
   PosterPilot never guesses. An entry moves only when the library mapping or an
   exact recorded revision proves its destination. Ambiguous entries are listed
   separately. You can cancel and correct the match, or explicitly accept the
   ambiguity and reapply those covers in PosterPilot after migration; reapplying
   writes them to the correct typed file. Existing conflicting typed entries are
   also left untouched for review.
3. **Confirm.** PosterPilot first records a durable migration journal and protected
   backups, writes and verifies **both** split files, and updates `config.yml`
   last. The legacy `posterpilot.yml` is never modified or deleted.
4. **Resume if needed.** A retry resumes the recorded operation from its verified
   checkpoint. It does not reclassify against changed inputs. If a source or
   target no longer matches either the previewed or already-written fingerprint,
   PosterPilot stops and asks for a fresh review instead of overwriting it.

When PosterPilot can safely prove ownership of the relevant `metadata_files`
entries, it rewires `config.yml` automatically. Otherwise it writes the split
files and gives you an exact per-library reference guide. **Do not paste that
partial `libraries:` block over your configuration.** In each named library,
replace only the `metadata_files` item whose `file` basename is
`posterpilot.yml`; if there is no such item, add the shown typed item once.
Preserve every sibling entry and library setting, and finish with exactly one
typed reference and no active legacy reference. Verify the paths from Kometa's runtime before acknowledging
completion in PosterPilot. That acknowledgment records your confirmation; it
does not claim that PosterPilot inspected or verified the manual edit.

The migration's **Rollback** action restores the protected pre-migration
`config.yml` backup only when the current config still matches the migration's
exact result. It deliberately keeps both split files, so generated artwork is not
discarded and a later retry does not need to rebuild them. The legacy file also
remains available throughout.

## Safety

The Kometa manager is built to be non-destructive:

- **Surgical merge (default).** In `merge` mode PosterPilot updates only the keys
  it owns and preserves all other content — your comments and unmanaged sections
  included. Deselecting a managed item removes only PosterPilot's entry, never your
  content. (`own` mode, opt-in via `KOMETA_CONFIG_MODE=own`, lets PosterPilot
  regenerate and fully own the file.)
- **Preview before write.** A diff is always shown first; nothing is written until
  you approve it. Secrets are redacted in the diff. The server-issued plan is
  expiring and single-use, and it is bound to the source file fingerprint, selected
  Plex instance, management mode, and complete proposed content. Editing any input
  invalidates the visible preview.
- **Atomic writes with a backup.** The new file is written atomically, and the
  previous version is kept beside it as `config.yml.posterpilot-bak-<timestamp>`.
- **Backups & restore.** The **Backups** section lists timestamped backups. Restore
  first creates an exact redacted diff and a separate confirmation; confirmation
  is rejected if the current file or selected backup changed. The current file is
  backed up before the atomic replacement.
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

## Raw editor contract

**Raw config.yml** loads the complete file. **Preview raw changes** first validates
YAML and creates the exact redacted diff. Invalid YAML receives no confirmation
plan. **Confirm raw save** is a separate action and writes only the content bound to
that plan. Editing the text, changing the source file, cancelling, expiry, or reuse
invalidates the plan and writes nothing.

## Named Plex binding

Kometa is Plex-only. In a multi-server installation, choose the named Plex instance
in Settings or set `KOMETA_SERVER_INSTANCE_ID`. Every structured/raw preview and
write remains bound to that instance and cannot borrow another server's credentials.

For the common mutation and revision guarantees, read
[Safety, verification, and undo](../safety/). For application-level backup and
restore, see [Automation and recovery](../automation-recovery/).

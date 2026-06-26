## Why

PosterPilot already writes a `posterpilot.yml` metadata file for Kometa to consume, but the user still has to hand-edit Kometa's own `config.yml` to point Kometa at Plex/TMDB, list their libraries, wire in that metadata file, and turn on the default collection sets they want. PosterPilot already holds all of this information (server URL + token, TMDB key, the included library sections, the assets directory) — duplicating it by hand is error-prone and drifts out of sync. This change lets PosterPilot keep the parts of `config.yml` it knows about in sync, surgically, without taking ownership of the rest of a user's hand-tuned config.

## What Changes

- **New "Kometa" settings tab** that manages a single Kometa `config.yml` on disk, located via a new configurable path (env `KOMETA_CONFIG_PATH`, persisted setting, default unset/off). The whole feature is **optional and off by default** — with no path set, the tab only shows a setup prompt and nothing is read or written.
- **Two management modes (default surgical).** `merge` (default): read the existing `config.yml`, update only the sections PosterPilot owns, write it back preserving every other key, hand-written entry, and comments; scaffold a minimal file if none exists. `own` (opt-in): PosterPilot fully owns the file and regenerates it from its settings on every sync, dropping keys it does not manage (the preview lists exactly which top-level keys would be removed; a backup is still written first).
- **Connections sync.** Fill the `plex:` and `tmdb:` sections from PosterPilot's already-stored Plex URL+token and TMDB API key, so the two tools never disagree. (Kometa manages Plex only; when PosterPilot's active server is Jellyfin/Emby the tab makes clear the sync uses the separately-stored Plex credentials and is a no-op without them.)
- **Libraries + metadata wiring.** Build the `libraries:` section from PosterPilot's included sections, and auto-add the generated `posterpilot.yml` as a `metadata_files` entry under each managed library so users no longer wire it by hand.
- **Default collections ("categories").** Let the user pick from Kometa's catalog of default collection sets (genre, studio, country, decade, franchise, …) per library; PosterPilot manages the matching `default:` entries in each library's `collection_files`.
- **Settings / webhooks / scheduling.** Manage a bounded set of global `settings:`, `webhooks:`, and run/schedule options that PosterPilot exposes in the tab.
- **Ownership boundary + safety.** PosterPilot tracks which keys/entries it manages so a later sync updates or removes only its own entries; a dry-run preview (diff) is shown before any write, and the file is written atomically with a timestamped backup.
- **No direct apply path change.** The existing `posterpilot.yml` export and the Plex/Jellyfin/Emby direct-apply flow are unchanged; this only adds management of Kometa's *own* config.

## Capabilities

### New Capabilities

- `kometa-config`: Read, update, and write Kometa's own `config.yml` — syncing connections, the libraries section, the `posterpilot.yml` metadata wiring, default collection sets, and a bounded set of global settings/webhooks — in either a surgical `merge` mode (preserve all unmanaged content and comments) or an opt-in `own` mode (PosterPilot regenerates and owns the whole file), with a preview-before-write and atomic backup-and-replace. Off entirely until a config path is configured.

### Modified Capabilities

- `configuration`: Add a Kometa **config-file path** as a recognized runtime input (env `KOMETA_CONFIG_PATH` + persisted setting), distinct from the existing Kometa **assets directory**, with the same env-overrides-UI precedence and env-managed indicator. Add persisted selections that drive the sync (which libraries are managed, which default collection sets are enabled, which global settings are managed).
- `deployment`: Add a mounted **Kometa config file/directory** so PosterPilot can read and write the user's existing Kometa `config.yml` from inside the container, alongside the already-mounted assets directory and data volume.

## Impact

- **New code:** `src/lib/server/kometa/config.ts` (load/merge/serialize/write of `config.yml`) + a default-collections catalog module + pure-function tests; a `src/routes/api/kometa/config/**` endpoint surface (load, preview-diff, sync); a new Kometa tab in `src/routes/settings/+page.svelte` and its server load.
- **Config layer:** new keys in `src/lib/server/config/index.ts` (`ConfigKey`, `ENV_MAP`, `WRITABLE_KEYS`, defaults) — `kometaConfigPath` plus the sync-selection settings.
- **Dependencies:** uses the existing `yaml` package via its document API (`parseDocument`) for comment-preserving edits — no new dependency expected.
- **i18n:** new message keys for the Kometa tab across all 5 catalogs (en/es/zh/ja/pt-BR).
- **Docs:** Starlight docs under `docs/` for configuring the Kometa config path and the new tab.
- **No breaking changes:** feature is off until a config path is set; the existing `posterpilot.yml` export, apply methods, and schema are untouched.

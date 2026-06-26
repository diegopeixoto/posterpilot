## Why

The `kometa-config-sync` change proved the hard part — surgically reading, merging, and writing Kometa's own `config.yml` while preserving comments and unmanaged content. Real configs (e.g. one with `tautulli`, `trakt`, per-library `overlay_files`, `operations`, and inline `collections`) showed two things: (1) users want PosterPilot to be the single place they manage **all** of Kometa, not just connections + a few collection defaults, and (2) the current surgical model is safe enough to build a full manager on. This change turns the feature into a **complete Kometa manager** on its own dedicated, cinematic page.

## What Changes

- **Dedicated `/kometa` page** (a new top-level nav destination) with a **cinematic spotlight hero** — an image-forward backdrop banner with the manager title and live status (config path, mode, last sync, managed-library count) overlaid — so a config-heavy surface still carries the app's "artwork is the hero" identity instead of becoming an *arr config wall. The management UI **moves out of the Settings → Kometa config tab** to this page (Settings keeps a one-line pointer); the config-path/mode controls move to the page header.
- **Structured forms for every connector** — `plex`, `tmdb`, `tautulli`, `trakt`, `mdblist`, `omdb`, `github`, `radarr`, `sonarr`, `notifiarr`, `gotify`, `ntfy`, `anidb`, `mal`, … — driven by a connector catalog (field name/key/type/secret/placeholder), with secret masking and connection-test where applicable.
- **Per-library: overlays + operations** added alongside the existing collection-defaults and metadata wiring — an `overlay_files` default picker (mediastinger, resolution, ribbon, audio_codec, network, …) and an `operations` toggle set (`mass_*`, `remove_overlays`, `delete_collections`, `assets_for_all`, …), plus per-library `settings` overrides.
- **Raw `config.yml` editor** — a full-file text editor sharing the same safety (YAML-parse validation, diff vs current, atomic write, timestamped backup) so anything not yet modeled by a form is still fully manageable. Nothing is unmanageable.
- **Backups panel** — list and **restore** the timestamped backups PosterPilot writes on each save.
- **Co-located metadata path** — `posterpilot.yml` is written into the **same directory as `config.yml`**, and the `metadata_files` entry references it as Kometa sees it (default bare `posterpilot.yml`). This **removes `KOMETA_METADATA_PATH`** and fixes the duplicate-entry/mount mismatch seen in practice.
- **Consistency validation** — warn before writing when an enabled chart/overlay needs a connector that isn't configured (e.g. a `trakt`/`tautulli` chart with no `trakt:`/`tautulli:` block).
- **Engine generalization** — the pure merge engine's plan/snapshot model becomes section-agnostic (managed connector keys, per-library overlay/operation/settings keys) so deselecting any managed item removes only PosterPilot's entry, never user content. Merge stays the default mode; own stays opt-in.

## Capabilities

### Modified Capabilities

- `kometa-config`: Extend from "sync connections + library defaults" to a complete manager — generic connector management, per-library overlays/operations/settings overrides, a raw-editor write path, backup listing + restore, and consistency validation — all on the same surgical merge/own engine. Change the metadata wiring to co-locate `posterpilot.yml` with `config.yml`.
- `configuration`: Remove the separate Kometa **metadata path** input; the metadata-file location is now derived from the config-file path (co-located). The config-management mode and config-file path remain runtime inputs.
- `web-ui`: Add a dedicated **Kometa manager page** as a top-level navigation destination, with a cinematic spotlight hero and localized, information-honest forms (not a config wall). The management UI no longer lives in the Settings tab.

## Impact

- **New/changed code:** new `src/routes/kometa/` page (+ server load) and nav entry; generalized `src/lib/server/kometa/config.ts` plan/snapshot; new catalogs (`connectors`, `overlay-defaults`, `operations`); a raw-editor + backups endpoint surface under `src/routes/api/kometa/config/**` (load/preview/sync/raw/backups/restore); the Settings page loses its Kometa tab.
- **Config layer:** drop `kometaMetadataPath`; derive the metadata location from `kometaConfigPath`.
- **Dependencies:** none new (existing `yaml` Document API + a code/text editor; a lightweight textarea-based editor avoids new deps).
- **i18n:** new keys for the page across all 5 locales.
- **Docs:** update the Kometa config-sync docs + deployment notes (single mounted config dir, no separate metadata mount).
- **No breaking changes for non-users:** off until a config path is set; merge remains default so existing rich configs are preserved.

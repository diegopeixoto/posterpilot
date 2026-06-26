## 1. Engine generalization (pure)

- [ ] 1.1 Extend `ConfigPlan` in `src/lib/server/kometa/config.ts` to be section-agnostic: `connections: Record<string, Record<string,string>>`, per-library `{ collections[], overlays[], operations, settingsOverrides, metadata }`, and `globals: { settings, webhooks }`
- [ ] 1.2 Extend `KometaSnapshot` to track managed keys per section (connectors, per-library overlays/operations/collection-defaults/setting-overrides) for safe removal
- [ ] 1.3 Generalize `applyPlan` to reconcile connectors (set/remove managed keys), `overlay_files` defaults, `operations`, per-library `settings`, and globals — reusing the structural-identity + snapshot removal pattern; keep anchor/alias skip + warnings
- [ ] 1.4 Add a pure consistency checker: enabled chart/overlay → required connector present? return warnings
- [ ] 1.5 Unit tests (`config.test.ts`): connector set/clear preserves siblings; overlay/operation add/remove; per-library settings override; idempotent re-sync; user content preserved; consistency warnings; own-mode regeneration still drops unmanaged

## 2. Catalogs (pure, client-safe)

- [ ] 2.1 `src/lib/server/kometa/connectors.ts` — connector → fields (`{label, key, type: text|secret|url|bool, placeholder}`) for plex/tmdb/tautulli/trakt/mdblist/omdb/github/radarr/sonarr/notifiarr/gotify/ntfy/anidb/mal
- [ ] 2.2 `src/lib/server/kometa/overlay-defaults.ts` — grouped overlay default names (mediastinger, resolution, audio_codec, ribbon, network, ratings, …) + `isKnownOverlay`
- [ ] 2.3 `src/lib/server/kometa/operations.ts` — known per-library operations + value types
- [ ] 2.4 Connector-dependency map (which charts/overlays require which connector) for the consistency checker
- [ ] 2.5 Unit tests for the catalogs (membership guards, dependency lookups)

## 3. Path co-location

- [ ] 3.1 Derive the metadata file location from `dirname(kometaConfigPath)`; default `metadata_files` value to the Kometa-relative basename `posterpilot.yml` (+ optional relative-prefix override)
- [ ] 3.2 Write `posterpilot.yml` into the config dir when config sync is configured (reconcile with the existing `KOMETA_ASSETS_DIR` export so there is exactly one file)
- [ ] 3.3 Migration: a prior non-co-located metadata entry is removed and replaced on the next sync (shown in preview)
- [ ] 3.4 Remove `kometaMetadataPath` from `AppConfig`/`ENV_MAP`/`WRITABLE_KEYS`/`resolveConfig`/`PublicConfig`; update tests

## 4. Orchestration & endpoints

- [ ] 4.1 Extend `sync.ts` `planFromSelections`/`loadKometaState` to cover connectors, overlays, operations, per-library settings, globals; include consistency warnings in results
- [ ] 4.2 Add `listBackups(path)` + `restoreBackup(path, name, stamp)` to `config-io.ts` (restore backs up current first); unit-test against a temp dir
- [ ] 4.3 `POST /api/kometa/config/raw` — validate + diff + atomic write (+ backup) of full text; `GET`/`POST` for backups list + restore
- [ ] 4.4 Re-baseline the managed snapshot after a raw save so structured + raw stay consistent
- [ ] 4.5 Endpoint tests (delegation, redaction, parse-error, restore writes-with-backup)

## 5. Dedicated `/kometa` page + spotlight

- [ ] 5.1 New route `src/routes/kometa/+page.svelte` + `+page.server.ts` (load: full Kometa state + catalogs + a spotlight backdrop candidate)
- [ ] 5.2 Add the Kometa entry to the main nav
- [ ] 5.3 Spotlight hero (reuse the library spotlight pattern): backdrop + title + live status overlay; `prefers-reduced-motion` honored; static fallback when no backdrop
- [ ] 5.4 Header: config path (+ resolved-path display), mode toggle, status, Preview/Sync actions
- [ ] 5.5 Sub-sections — **Connections** (catalog-driven forms, secrets masked, test where applicable), **Libraries** (collections + overlays + operations + settings + metadata per library), **Settings & Webhooks**
- [ ] 5.6 **Raw** editor (monospace textarea, validate, diff, save) and **Backups** (list + restore with confirm)
- [ ] 5.7 Surface consistency/anchor warnings, dropped-keys (own mode), and the secrets-on-disk notice in the preview

## 6. Remove the Settings Kometa tab

- [ ] 6.1 Remove the `kometa` tab from `src/routes/settings/+page.svelte`; drop the now-unused Kometa state/handlers there
- [ ] 6.2 Add a one-line pointer from Settings to `/kometa`
- [ ] 6.3 Keep the config-path/mode persistence working through `/api/settings` (now driven from the `/kometa` header)

## 7. Internationalization

- [ ] 7.1 Add all new manager-page message keys to `messages/en.json`
- [ ] 7.2 Mirror across `es.json`, `zh.json`, `ja.json`, `pt-BR.json` at full parity; remove keys orphaned by the tab removal
- [ ] 7.3 `m.*` accessors; `bun run check` compiles Paraglide with no missing keys

## 8. Documentation

- [ ] 8.1 Update the Kometa config-sync docs page: dedicated manager, connectors/overlays/operations, raw editor, backups/restore, co-located metadata (no `KOMETA_METADATA_PATH`)
- [ ] 8.2 Update deployment docs: single mounted config dir (no separate metadata mount); remove `KOMETA_METADATA_PATH` from `.env.example`/compose/README/unraid template

## 9. Quality gates & verification

- [ ] 9.1 `bun run check` (0 errors)
- [ ] 9.2 `bun run test`
- [ ] 9.3 `bun run build`
- [ ] 9.4 `bun run lint`
- [ ] 9.5 Manual verify in a rebuilt container against the real sample config: connectors/overlays/operations round-trip, raw edit + restore, co-located `posterpilot.yml`, unmanaged content preserved, spotlight renders
- [ ] 9.6 Self-review the diff; PR on the feature branch (no direct push to `main`, no Claude trailers)

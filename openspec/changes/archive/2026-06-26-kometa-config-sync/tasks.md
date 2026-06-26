## 1. Config layer & persisted selections

- [x] 1.1 Add `kometaConfigPath` to `AppConfig`, `ENV_MAP` (`KOMETA_CONFIG_PATH`), `WRITABLE_KEYS`, `resolveConfig`, and defaults (`''`) in `src/lib/server/config/index.ts` (mirrors `kometaAssetsDir`); optionally add a `kometaMetadataPath` override the same way (default = `kometaAssetsDir`)
- [x] 1.2 Add internal KV accessors following the existing `cachedLibraries` pattern (NOT `saveSettings`/`WRITABLE_KEYS`/`ENV_MAP`) for the non-env selection blobs: `kometaManagedLibraries` (string[]), `kometaDefaultCollections` (map library→string[]), `kometaManagedSettings`, and `kometaLastApplied` snapshot — each with `get*`/`set*` helpers
- [x] 1.3 Confirm env-overrides-DB precedence for `kometaConfigPath`; confirm the KV accessor blobs round-trip through the `settings` table without touching `AppConfig`
- [x] 1.4 Unit test: config resolution for `kometaConfigPath` (env wins, DB persists, default empty) and round-trip of each KV selection accessor (`src/lib/server/config/index.test.ts`)

## 2. Default-collections catalog

- [x] 2.1 Create `src/lib/server/kometa/defaults-catalog.ts` with the frozen, grouped catalog of Kometa default collection names — suffixed content-rating files (`content_rating_us`/`uk`/`de`/`au`/`nz`/`mal`/`cs`), no bare `content_rating`
- [x] 2.2 Add an `isKnownDefault(name)` membership guard and a movie-vs-show applicability hint per entry
- [x] 2.3 Unit test: membership guard accepts catalog names and rejects unknown values

## 3. Pure config-merge engine

- [x] 3.1 Create `src/lib/server/kometa/config.ts`; implement `loadDoc(raw)` using `parseDocument` from `yaml` (comment/order preserving)
- [x] 3.2 Implement `buildPlan(...)` → desired managed state (plex/tmdb values, per-library metadata_files using the **Kometa-visible** path + collection_files default set, bounded settings/webhooks)
- [x] 3.3 Implement `applyPlan(doc, plan, snapshot)` → mutate Document via `setIn`/`deleteIn`/seq edits using structural identity; only claims defaults it actually added (never a user's pre-existing `- default:`)
- [x] 3.4 Implement `serialize(doc)`, `scaffoldDoc(plan)` for the missing-file case, and `redactSecrets(diff)` masking `plex.token`/`tmdb.apikey`
- [x] 3.5 Implement diff computation (add/modify/remove with before/after) and `nextSnapshot` output for persistence
- [x] 3.6 Detect YAML anchors/aliases within a managed section and surface a skip-with-warning result instead of editing
- [x] 3.7 Unit tests (`config.test.ts`, `$env`-free): unmanaged content + comments preserved (semantic); idempotent re-sync; deselect removes only managed entry; enable/disable default sets; user siblings preserved; secrets redacted; scaffold valid; anchors skipped

## 4. Atomic file I/O

- [x] 4.1 Create `src/lib/server/kometa/config-io.ts` with `readConfig(path)` and `writeConfigAtomic(path, text, stamp)` (temp-write → `rename`, timestamped backup before replace)
- [x] 4.2 Add an in-process single-flight lock so concurrent syncs can't interleave on the same file
- [x] 4.3 Backup pruning to the last N (default 5)
- [x] 4.4 Unit test the pure parts; smoke-test atomic write + backup against a temp dir

## 5. API endpoints & settings load

- [x] 5.1 Extend `src/routes/settings/+page.server.ts` load with Kometa-tab data (via `loadKometaState`): path, mode, parsed managed-state, available libraries, defaults catalog, file exists/parses flags
- [x] 5.2 Add `POST /api/kometa/config/preview` → returns redacted structured diff, no write (pure `parseSelectionInput` extracted to `selection.ts`)
- [x] 5.3 Add `POST /api/kometa/config/sync` → atomic write + backup, persist selections + new snapshot, `logEvent('info','kometa',…)`; return result
- [x] 5.4 Endpoint tests: preview delegates + redacts; sync delegates + surfaces parse error; selection-parser unit tests
- [x] 5.5 Extend the settings page client `save()` payload to include `kometaConfigPath`/`kometaMetadataPath` (and `kometaConfigMode`); path saves through existing `/api/settings`

## 6. Kometa settings tab (UI)

- [x] 6.1 Add a "Kometa" tab to `src/routes/settings/+page.svelte` tab set (server / providers / advanced / **kometa** / language / activity)
- [x] 6.2 Config-path + metadata-path override controls with env-managed indicator; setup-prompt when unset; show the resolved metadata `file:` path
- [x] 6.3 Managed-library selector and per-library default-collection picker grouped by catalog category
- [x] 6.4 Bounded managed-settings/webhooks inputs
- [x] 6.5 Preview action → render the redacted diff; explicit Sync; Plex-only/missing-creds notices and secrets-on-disk warning; `invalidateAll()` on success
- [x] 6.6 Handle missing-file (scaffold note) and unparseable-file (error, sync disabled) states in the UI

## 7. Internationalization

- [x] 7.1 Add all new Kometa-tab message keys to `messages/en.json`
- [x] 7.2 Mirror the keys across `es.json`, `zh.json`, `ja.json`, `pt-BR.json` at full parity (314 keys each, verified)
- [x] 7.3 Use `m.*` accessors in the tab; `bun run check` compiles Paraglide with no missing keys

## 8. Documentation

- [x] 8.1 Add Starlight docs under `docs/` (`kometa-config-sync.md`): paths, tab workflow, merge-vs-own, backups, secrets-on-disk; sidebar + configuration.md updated
- [x] 8.2 Note the deployment requirement (mounted config file/dir) in `installation.md` alongside the existing assets-dir/data-volume docs

## 9. Quality gates & verification

- [x] 9.1 `bun run check` (0 errors; warnings are the pre-existing `state_referenced_locally` pattern)
- [x] 9.2 `bun run test` (194 pass, incl. all new pure-function + endpoint tests)
- [x] 9.3 `bun run build`
- [x] 9.4 `bun run lint` (all changed `src/` + `messages/` files clean; remaining failures are pre-existing untracked `.impeccable/`/`.github/hooks/` files)
- [ ] 9.5 Manual verify in a rebuilt container (needs `docker compose up -d --build`): configure path, preview, confirm sync against a sample `config.yml` with comments/hand-written keys; assert unmanaged content + comments preserved and a backup was written
- [ ] 9.6 Self-review the diff; open the PR from branch `feat/kometa-config-sync` (no direct push to `main`, no Claude trailers)

## 10. Two management modes (merge / own) — added per maintainer request

- [x] 10.1 Add `kometaConfigMode` (`merge` default | `own`) to config layer (`AppConfig`/`ENV_MAP` `KOMETA_CONFIG_MODE`/`WRITABLE_KEYS`/`resolveConfig`/`PublicConfig`)
- [x] 10.2 Engine: `buildOwnedDoc(plan)` (fresh fully-owned document) + `topLevelKeys(doc)` for drop reporting; `config.test.ts` coverage
- [x] 10.3 `sync.ts`: branch preview/run on mode; in `own` mode regenerate + report dropped top-level keys; backup still written
- [x] 10.4 UI: mode selector + own-mode warning + dropped-keys list in the preview; persist mode via `save()`
- [x] 10.5 i18n: `kometa_mode*` / `kometa_dropped` keys added to all 5 catalogs (314 keys each)

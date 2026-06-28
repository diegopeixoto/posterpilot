> **Depends on `granular-artwork-and-collapse` (PR #20).** That change is the substrate: it
> introduces `childSelections`, `child-apply.ts` `resolveChildOps`, the per-slot/season-group/collapse
> item UI, and migration `0005`. Branch this change off `main` *after* PR #20 merges. Scoring,
> suggestion, dry-run, and ignore all extend the per-slot model rather than the old show-level-only one.

## 1. Schema & migration

- [x] 1.1 Add `mediaItems.ignored` (boolean, default false), `mediaItems.serverUpdatedAt`, `mediaItems.lastSyncedAt` to `db/schema.ts`
- [x] 1.2 Add `posterCandidates.width`, `posterCandidates.height`, `posterCandidates.score` to `db/schema.ts` (covers all slot kinds: poster/background/season/title_card)
- [x] 1.3 Add `thumbnailCache` table (`urlHash` PK, `url`, `contentType`, `sizeBytes`, `fetchedAt`, `accessedAt` for LRU; bytes live on disk) to `db/schema.ts`
- [x] 1.4 Run `bun run db:generate` (yielded `0006_breezy_sinister_six`, sequenced after PR #20's `0005`) and commit migration + snapshot

## 2. Secrets encryption (capability: secrets-encryption)

- [x] 2.1 Create `src/lib/server/secrets/key.ts`: resolve key from `APP_SECRET` (scrypt) or generate+persist `data/.app-key` (0600), cached
- [x] 2.2 Create `src/lib/server/secrets/crypto.ts`: AES-256-GCM `encrypt`/`decrypt` with versioned `enc:v1:<base64(iv|tag|ct)>` format
- [x] 2.3 Wrap `saveSettings` in `config/index.ts` to encrypt secret-typed keys before persisting
- [x] 2.4 Wrap `loadSettings`/`resolveConfig` to decrypt secrets; legacy unprefixed values pass through as plaintext (lazy migration on next save)
- [x] 2.5 Treat undecryptable secrets as unset (no crash) — loadSettings drops them so `publicConfig` reports them unset (re-enter prompt)
- [x] 2.6 Unit tests: round-trip, random-IV uniqueness, encrypted/plaintext detection, plaintext passthrough, wrong-key + tamper → throw (6 passing)

## 3. Emby/Jellyfin login-by-name (capability: media-server)

- [x] 3.1 Add `loginByName(baseUrl, username, password, flavor)` in `media-server/emby.ts` (POST `/Users/AuthenticateByName`, send `Authorization`+`X-Emby-Authorization`, parse via pure `parseAuthResult`)
- [x] 3.2 Add API route `POST /api/media-server/login` (`{flavor,baseUrl,username,password}`) storing url + token as the encrypted server credential; password never persisted
- [x] 3.3 Detect 401/403 → `testConnection` returns `unauthorized` flag (surfaced as re-login prompt in the UI)
- [x] 3.4 Unit tests for the auth-response parser (`emby-auth-parse.test.ts`, `$env`-free; 3 passing)
- [x] 3.5 Settings UI: Emby/Jellyfin username/password login form (mirroring `PlexLogin.svelte`), manual API-key entry kept as advanced fallback

## 4. Per-item server timestamp + incremental rescan (capabilities: media-server, background-jobs)

- [x] 4.1 Extend media-server `types.ts` item shape + Plex/Emby/Jellyfin list mappers to expose `serverUpdatedAt` (Plex `updatedAt`×1000, Jellyfin/Emby `DateLastModified`); pure parsers in plex/parse.ts + emby-parse.ts
- [x] 4.2 Persist `serverUpdatedAt`/`lastSyncedAt` in `runSyncJob`; skip TMDB resolve+enrich when unchanged (via pure `shouldReprocessItem`)
- [x] 4.3 Add `full` payload flag to force a complete rescan; prune-removed behavior preserved
- [x] 4.4 Tests for the "changed vs unchanged vs unknown-timestamp" decision logic (`jobs/incremental.test.ts`, 7 cases)

## 5. Ignore list (capabilities: poster-application, background-jobs, web-ui)

- [x] 5.1 Add `setItemIgnored(id, ignored)` in `queries.ts` + `POST /api/items/[id]/ignore`
- [x] 5.2 Exclude ignored items in `runDiscoverJob`/`runApplyJob` selection queries
- [x] 5.3 Library grid: ignore toggle, ignored visual marker, ignored filter chip (item-level, alongside PR #20's grid)
- [x] 5.4 i18n keys for ignore UI across all 5 catalogs

## 6. Binary thumbnail cache (capability: poster-providers)

- [x] 6.1 Create `src/lib/server/posters/thumb-cache.ts`: store under `data/thumb-cache/<sha256(url)>` + index row; TTL + size-bound LRU prune
- [x] 6.2 Add proxy route `GET /api/thumb?url=` serving cached bytes with long `Cache-Control`, fetch+store on miss
- [x] 6.3 Point provider preview image rendering at `/api/thumb?url=` in the UI
- [x] 6.4 Tests for hashing, TTL expiry, and LRU eviction (pure helpers; 11 cases)

## 7. Candidate scoring + suggestion (capabilities: poster-providers, poster-application, web-ui)

- [x] 7.1 Create `src/lib/server/posters/score.ts`: `scorePoster(candidate, weights)` = providerWeight + resolution + aspect-fit (2:3 poster / 16:9 background)
- [x] 7.2 Capture image dimensions + compute `score` during `discoverForItem`; persist to `posterCandidates` (TMDB supplies real dims; others provider-weighted); weights via `score-weights.ts`
- [x] 7.3 Replace flat order in `autoSelectPoster` with highest-score selection (`desc(score)`, nulls last); job-level ignore exclusion
- [x] 7.4 Item view: pre-select top-scored candidate **per slot** (show + each season + each episode, via PR #20's `childSelections`/`selectChild` model), mark as "suggested", keep fully overridable
- [x] 7.5 Honor the "disable suggestion pre-select" setting
- [x] 7.6 Unit tests for `scorePoster` ranking + tie-breaks (10 cases)

## 8. Dry-run apply (capabilities: poster-application, web-ui)

- [x] 8.1 Add `dryRun` option to `applyToItem` in `service.ts`: assemble planned ops via `resolveChildOps` with no network/DB writes
- [x] 8.2 Add preview to `POST /api/items/[id]/apply` (dry-run flag) and a bulk preview `POST /api/apply/preview` aggregating per-item plans
- [x] 8.3 Bulk apply UI: show preview (counts of uploads/exports/skips) and require explicit confirm
- [x] 8.4 i18n keys for the preview UI across all 5 catalogs
- [x] 8.5 Tests asserting dry-run performs zero writes and matches real-apply plan shape (service.test.ts)

## 9. Concurrent bulk apply (capability: background-jobs)

- [x] 9.1 Wrap the apply-job item loop in `createLimiter(applyConcurrency)`; emit progress per completion; check `isCancelled()` per item
- [x] 9.2 Add `applyConcurrency` setting (default 4) to `config/index.ts` (Settings UI control in 10.2)
- [x] 9.3 Per-item failure isolation (try/catch) + mid-batch cancellation guard implemented (runtime re-verify in 11.6)

## 10. Configuration surface (capability: configuration)

- [x] 10.1 Add settings keys: scoring weights (KV), thumbnail-cache TTL/size, `applyConcurrency`, suggestion-preselect toggle, incremental-sync default
- [x] 10.2 Settings UI controls for the above; respect env-override precedence and secret redaction
- [x] 10.3 i18n keys for new settings across all 5 catalogs

## 11. Docs & quality gates

- [x] 11.1 Docs for **this change** (Starlight `docs/src/content/docs/`): `configuration.md` — `APP_SECRET` + `data/.app-key`, encryption/migration, new settings (scoring weights, apply concurrency, thumbnail-cache TTL/size, suggestion toggle, incremental sync); `usage.md` — Emby/Jellyfin login-by-name, ignore items, dry-run preview, suggested posters; `installation.md` — `APP_SECRET` env
- [x] 11.2 Docs for **PR #20** (merged but undocumented): `usage.md` — granular season/episode artwork, "Use this set", granular revert (revert season / revert all), collapsible provider/set/season sections
- [x] 11.3 Update `README.md` "What it does" with both PR #20 (granular/collapsible artwork) and this change's features (login-by-name, encrypted secrets, dry-run, ignore, suggestions, faster sync/apply)
- [x] 11.4 Mirror the English doc updates to the other 4 locales (`ja/`, `zh/`, `pt-br/`, `es/`) for parity
- [x] 11.5 Run `bun run check` (0 errors), `bun run test`, `bun run build`, `bun run lint`
- [x] 11.6 Self-review the diff; confirm manual token entry, full rescan, and manual selection all still work

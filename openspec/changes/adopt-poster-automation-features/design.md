## Context

PosterPilot already has most of the machinery this change builds on: a key-value `settings` store
(`config/index.ts`), the Plex app.plex.tv/auth OAuth flow (`PlexLogin.svelte` + `/api/plex/pin`),
an `httpCache` table for provider JSON/HTML, a persisted job queue with SSE progress and
cancellation (`jobs/runner.ts`, `events.ts`), provider-order auto-select (`autoSelectPoster`), and a
Kometa dry-run pattern (`previewSync`). The gaps versus the sibling project are: secrets sit in
SQLite **plaintext**; **Emby/Jellyfin** auth still requires pasting an API key; there is no poster
dry-run, ignore list, incremental rescan, binary thumbnail cache, concurrent apply, or real scoring
model. This change closes those gaps by extending existing modules, not rebuilding them, and keeps
scoring as a **suggestion the user confirms** rather than an auto-apply default.

This change also builds on `granular-artwork-and-collapse` (PR #20), which lands per-slot
selection (`childSelections`, `child-apply.ts`'s `resolveChildOps`) and a season-group/collapse item
UI. It should branch off `main` after PR #20 merges; its migration follows `0005` as `0006`. The
consequence is favorable: scoring/suggestion apply **per slot** (show + each season + each episode)
and dry-run reuses `resolveChildOps` for free.

## Goals / Non-Goals

**Goals:**
- Encrypt secret settings values at rest, transparently, with zero UI change and lazy migration.
- Let Emby/Jellyfin users authenticate by username/password (login-by-name) instead of pasting an API key.
- Add a dry-run preview for poster apply (single + bulk).
- Add a per-item ignore flag honored by discover/apply/auto-select and the library UI.
- Make sync incremental (skip unchanged items) while keeping a full-rescan escape hatch.
- Cache provider preview images as binary, size/TTL-bounded, to cut bandwidth and speed the grid.
- Run bulk apply with bounded concurrency, reusing existing progress/cancellation.
- Replace flat provider-order auto-select with a configurable scoring model surfaced as a pre-selected, overridable suggestion.

**Non-Goals:**
- Auto-applying artwork without explicit user action (scoring never auto-applies).
- Dropping manual token entry, full rescan, or manual selection — all remain as fallbacks.
- Rewriting the Plex auth flow (already at parity); at most a popup-polish tweak.
- Multi-account / multi-server-at-once support.
- A secrets vault / external KMS — instance-local key only.

## Decisions

### 1. Encryption at rest — AES-256-GCM via `node:crypto`, instance key, lazy migration
Encrypt only secret-typed setting values (`plexToken`, `jellyfinApiKey`, `embyApiKey`, `tmdbKey`,
`fanartKey`). Stored form is a versioned, self-describing string: `enc:v1:<base64(iv|tag|ciphertext)>`.
Reads in `resolveConfig` detect the `enc:v1:` prefix and decrypt; values without the prefix are
treated as plaintext and re-encrypted on next `saveSettings` (lazy migration). Env-var overrides are
never persisted, so never encrypted.

- **Key source**: the app creates the key itself with **no user interaction**. If an optional
  `APP_SECRET` env var is set, a 32-byte key is derived from it via scrypt (fixed salt) — useful for
  multi-replica/shared-key deployments. Otherwise the app auto-generates a 32-byte key once and
  persists it to `data/.app-key` (0600), reusing it on every boot. `APP_SECRET` is therefore never
  required, and **existing installs must not break**: a legacy plaintext secret (no `enc:v1:`
  prefix) is read through unchanged and re-encrypted on its next save, so upgrades need zero manual
  steps.
- **Why GCM over Fernet (their choice, AES-128-CBC+HMAC)**: AEAD in one primitive, no extra deps
  (Node built-in), 256-bit. Alternative considered: libsodium secretbox — rejected to avoid a native dependency in the single-container build.

### 2. Emby/Jellyfin login-by-name → access token
Add `loginByName(baseUrl, username, password, flavor)` that POSTs to `/Users/AuthenticateByName`
(`{ Username, Pw }`) with the device/client auth header each flavor needs
(`Authorization: MediaBrowser ...` / `X-Emby-Authorization`), parses `AccessToken` + `User.Id`, and
stores the access token as the existing `*ApiKey` secret (now encrypted). The existing
`embyLikeProvider` auth headers are unchanged at request time. Manual API-key entry stays as the
advanced fallback, mirroring Plex's layout. A 401 at request time surfaces a "log in again" prompt.

- **Why login-by-name over OAuth/Quick Connect**: it's the universally supported path on both
  servers and removes the token-hunting step. Quick Connect is deferred (server-config-dependent).

### 3. Dry-run apply — a `dryRun` flag on the apply path
`applyToItem(..., { dryRun: true })` resolves child ops (`resolveChildOps`) and assembles the full
list of planned operations (per slot: target child, image URL, method plex/kometa/both, lock change,
or "skipped + reason") **without** performing any network write or DB record. Returns the same shape
as a real apply minus side effects, mirroring `previewSync`. The bulk apply route gains a preview
mode that aggregates per-item plans so the UI can show "N uploads, M exports, K skipped" before the
user confirms.

### 4. Ignore list — a boolean column on `mediaItems`
Add `mediaItems.ignored` (default 0). Discover, apply, and auto-select queries filter it out; the
library grid shows an ignore toggle and a filter chip; ignored items are visually marked.

- **Why a column over a settings list**: joins/filters naturally at query time, scales to large
  libraries, and survives re-sync (keyed by item, not rating key string in a blob).

### 5. Incremental rescan — compare server timestamp to last sync
Expose a per-item "server updated" timestamp through the media-server interface (Plex `updatedAt`,
Jellyfin/Emby `DateLastModified`). Store `mediaItems.serverUpdatedAt` + `lastSyncedAt`. `runSyncJob`
skips TMDB re-resolution/enrichment for items whose server timestamp is unchanged since last sync. A
`full: true` payload flag forces a complete pass.

- **Risk**: a server that doesn't bump the timestamp on artwork-relevant changes → keep full rescan available and document it.

### 6. Binary thumbnail cache — on-disk under the data dir
Cache provider preview images on disk at `data/thumb-cache/<sha256(url)>` with a small index table
(`thumbnailCache(urlHash PK, url, contentType, bytes, fetchedAt)`) for TTL + LRU pruning. A proxy
route `/api/thumb?url=<provider-url>` serves cached bytes with long `Cache-Control`, fetching+storing
on miss. Size cap + TTL evict oldest.

- **Why disk over a SQLite BLOB**: keeps image bytes out of the libsql DB file (which already holds
  `httpCache` text), makes eviction a file delete, and avoids DB bloat/VACUUM concerns. Alternative
  (BLOB column) considered — simpler single-store but worse for large binary churn.

### 7. Concurrent bulk apply — `p-limit` around the apply loop
Wrap the apply job's per-item loop in `p-limit(applyConcurrency)` (default 4, configurable), reusing
`ctx.progress` for per-item completion events and checking `ctx.isCancelled()` per item. This is the
same pattern MediUX discovery already uses locally.

- **Risk**: media-server rate limits / lock contention under high concurrency → modest default,
  configurable, and per-request errors are recorded per item (apply already records per-item outcome).

### 8. Suggested scoring — score candidates, pre-select, never auto-apply
Add `width`, `height`, `score` to `posterCandidates`; a `scorePoster(candidate, weights)` computes
`providerWeight + resolutionScore + aspectScore` (aspect target 2:3 posters, 16:9 backgrounds),
weights configurable in settings. Discovery records dimensions+score; the item UI **pre-selects** the
top-scored candidate per slot as a suggestion with a clear "suggested" marker, fully overridable.
`autoSelectPoster` switches from flat provider order to highest score (still only on explicit user
action / the user-triggered apply job).

- **Why suggestion, not automation**: preserves the product's "user curates, artwork is the hero"
  identity (PRODUCT.md). A setting can disable pre-selection for users who want a blank slate.

## Risks / Trade-offs

- **Lost/changed `APP_SECRET` → secrets undecryptable** → Mitigation: auto-generate + persist
  `data/.app-key` so restarts are stable without any env setup; document that backing up the data dir
  (or pinning `APP_SECRET`) preserves secrets; on decrypt failure, fall back to "secret unset" so the
  user simply re-logs-in/re-enters the key rather than hitting a hard error.
- **Emby/Jellyfin access tokens can expire/be revoked** → Mitigation: detect 401 and surface a
  re-login prompt; keep manual key entry.
- **Incremental rescan misses changes** if the server doesn't update its timestamp → Mitigation:
  full rescan stays one click away and is documented.
- **Thumbnail cache disk growth** → Mitigation: TTL + size cap with LRU prune; cache is purely
  derived and safe to wipe.
- **Concurrency overwhelms the media server** → Mitigation: conservative default (4), configurable,
  per-item error isolation.
- **Scoring pre-select surprises users / fights curation** → Mitigation: clearly marked as
  "suggested", trivially overridable, and disable-able in settings.
- **Encryption breaks external SQLite readers** (BREAKING) → Mitigation: documented; values are
  self-describing (`enc:v1:` prefix) and the app reads both forms during migration.

## Migration Plan

1. Ship the Drizzle migration: `mediaItems.ignored`, `mediaItems.serverUpdatedAt`,
   `mediaItems.lastSyncedAt`; `posterCandidates.width/height/score`; `thumbnailCache` table.
2. On first boot after deploy, `migrateDb()` applies it (existing startup path). Encryption is lazy:
   existing plaintext secrets keep working and are encrypted the next time the user saves settings; an
   optional one-time startup pass can encrypt-in-place.
3. Document `APP_SECRET` (optional) and the auto-generated `data/.app-key` in deployment docs.
4. **Rollback**: the `enc:v1:` prefix lets a reverted (encryption-unaware) build still read any
   secrets the user hasn't re-saved as plaintext; advise re-entering secrets if rolling back after
   encryption has run.

## Open Questions

- Thumbnail cache store: on-disk (proposed) vs SQLite BLOB — confirm disk is acceptable in the
  target container/volume layout.
- One-time eager encryption pass at startup, or purely lazy on next save? (lean lazy.)
- Default `applyConcurrency` value — 4 proposed; validate against Plex/Emby behavior.
- Scoring weight defaults and whether backgrounds use a separate weight profile.

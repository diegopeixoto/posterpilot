## Why

A sibling project (primetime43/PosterPilot, Python/Vue, Plex-only) ships several quality-of-life
and safety features we lack: encrypted credentials at rest, login-based auth (no token paste),
dry-run apply, an ignore list, incremental rescans, image caching, concurrent batch apply, and
score-based poster suggestions. Most map onto machinery we already have (Plex PIN auth, the
`httpCache` table, the job runner + SSE progress, provider-order auto-select, the Kometa preview
pattern), so this is mostly hardening and extending what exists. We adopt all of it **without**
inheriting their automation-first identity: scoring stays a *suggestion the user confirms*, never
an auto-apply default — PosterPilot remains multi-server and visual-curation-first.

## What Changes

- **Login-based media-server auth (no token paste).** Plex is already done — `PlexLogin.svelte` +
  `/api/plex/pin` implement the full app.plex.tv/auth OAuth flow (login button, OAuth URL,
  plex.tv/link code fallback, polling, server discovery). The real gap is **Emby/Jellyfin**, which
  still require pasting an API key; add username/password login-by-name that exchanges credentials
  for an access token server-side. Manual token entry stays as a fallback. *(Optional Plex polish:
  swap the "authorize directly" new-tab link for a managed `window.open` popup that auto-closes on
  success — presentation only, no new capability.)*
- **Encrypted secrets at rest.** Media-server tokens and provider API keys are currently stored
  plaintext in the `settings` table. Encrypt secret values with an instance key (AES-256-GCM). The
  key is **created by the app with zero user interaction** — auto-generated and persisted to
  `data/.app-key` on first boot; an optional `APP_SECRET` env var overrides it only for
  multi-replica/shared-key deployments. **Existing installs never break**: legacy plaintext secrets
  are read transparently and re-encrypted on next save. Only direct external readers of the SQLite
  `settings` table see ciphertext (**BREAKING** for them alone).
- **Dry-run apply.** A preview mode for poster apply (mirroring the Kometa `previewSync` pattern)
  that reports exactly what *would* be uploaded/locked/exported per slot, without writing to the
  server. Surfaced before bulk apply.
- **Ignore list.** Per-item "leave this alone" flag; ignored items are skipped by discover/apply
  and auto-select, and visually marked / filterable in the library.
- **Incremental (diff-based) rescan.** Sync compares against the server's per-item updated
  timestamp and only re-resolves/re-enriches items that changed since the last sync, instead of a
  full pass every time. Full rescan stays available.
- **Binary thumbnail cache.** Add an on-disk/blob cache for provider preview images (today only
  the JSON/HTML responses are cached via `httpCache`), cutting provider bandwidth and speeding the
  grid on revisits. TTL/size-bounded.
- **Concurrent bulk apply.** The apply job runs items sequentially today; add bounded concurrency
  (reuse the `p-limit` pattern + existing per-job progress/cancellation) so large batches finish
  faster.
- **Suggested poster scoring.** A configurable scoring model (provider weight, resolution, aspect
  ratio) ranks candidates and **pre-selects** the top one in the UI as a suggestion the user
  confirms or overrides — replacing today's flat provider-order `autoSelectPoster`. Never auto-applies.

## Capabilities

### New Capabilities
- `secrets-encryption`: encryption-at-rest for stored credentials — instance key management, AES-GCM
  encrypt/decrypt of secret settings values, transparent read path, and one-time migration of
  existing plaintext secrets.

### Modified Capabilities
- `media-server`: Emby/Jellyfin gain login-by-name auth (credentials → access token) alongside the
  existing Plex PIN flow and manual-token fallback.
- `configuration`: secret settings values are stored encrypted; new settings for ignore list,
  scoring weights, thumbnail-cache TTL/size, and incremental-sync behavior.
- `poster-application`: new dry-run preview path; ignored items are excluded from apply; suggested
  scoring pre-selects a candidate (replacing flat provider-order auto-select).
- `poster-providers`: candidates carry scoring metadata (resolution/aspect/provider) used for
  ranking; provider preview images served through a binary thumbnail cache.
- `background-jobs`: sync supports incremental/diff-based rescan; the apply job runs with bounded
  concurrency; discover/auto-select skip ignored items.
- `web-ui`: Emby/Jellyfin login form; ignore toggle + filter in the library; dry-run preview before
  bulk apply; suggested poster shown as a pre-selected, overridable choice.

## Impact

- **Schema**: `mediaItems` gains `ignored` + a server-side `updatedAt`/`lastSyncedAt` for diff
  detection; `posterCandidates` gains scoring columns (e.g. `width`, `height`, `score`); new
  thumbnail-cache table (or reuse `httpCache` with a binary column). Drizzle migration required.
- **Server**: `config/index.ts` (encrypt/decrypt around `saveSettings`/`resolveConfig`), new
  `secrets/` crypto module, `media-server/emby.ts` + new auth helpers (login-by-name),
  `posters/service.ts` (dry-run, scoring, ignore checks), `posters/providers/*` (scoring metadata +
  thumbnail cache), `jobs/tasks.ts` + `jobs/runner.ts` (incremental sync, concurrent apply),
  `queries.ts`.
- **API**: new routes for Emby/Jellyfin login and dry-run preview; `select`/`apply`/`sync` routes
  extended for ignore + incremental + suggestion.
- **UI**: settings (login forms), library (ignore, filter, suggestion pre-select), apply flow
  (dry-run preview).
- **i18n**: new keys across all 5 catalogs (`en`, `es`, `zh`, `ja`, `pt-BR`).
- **Config/Docs**: `APP_SECRET` env var documented; encryption + migration noted in deployment docs.
- **No breaking UI changes**: manual token entry, full rescan, and manual selection all remain;
  only direct SQLite `settings` readers are affected by encryption.

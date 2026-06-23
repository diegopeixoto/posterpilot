## Context

PosterPilot's server logic talks to Plex directly. `src/lib/server/plex/client.ts` exposes free functions (`testConnection`, `listSections`, `listItems`, `uploadPosterFromUrl`, `uploadPosterBytes`, `setPosterLock`) that each take `(baseUrl, token, …)` and parse Plex's `MediaContainer` JSON. The sync task, the discover flow, and the apply flow import these directly. Configuration (`src/lib/server/config/index.ts`) models exactly one server: `plexUrl` + `plexToken`, with an `ENV_MAP`, `WRITABLE_KEYS`, `SECRET_KEYS`, `requireConfig`, `publicConfig`, and `redact`. There is **no** Plex login: the only path to a token is the user pasting one, and the only path to a URL is typing it.

This change generalizes the server tier to Plex, Jellyfin, and Emby behind one interface, and adds the missing Plex onboarding (PIN token-acquire + connection discovery). Jellyfin and Emby derive from the same Emby codebase, so their HTTP APIs (auth header, `/System/Info`, `/Library/VirtualFolders` or `/Items`, `/Items/{id}/Images/{type}`) are near-identical, letting one shared implementation cover both with small differences.

Stack constraints: SvelteKit + Svelte 5 runes, Bun, Drizzle/SQLite (libsql), Tailwind v4, in-process job queue with SSE. Self-hosted single-user scale.

## Goals / Non-Goals

**Goals:**

- A `MediaServer` provider interface that the whole app depends on, with Plex/Jellyfin/Emby implementations selected by an active server type.
- Refactor existing Plex code into the Plex provider with **no behavior change** for current Plex users.
- Plex PIN login that acquires a token via plex.tv, and connection discovery that lets the user pick a local/remote URL.
- Jellyfin/Emby via base URL + API key, applying artwork through `POST /Items/{id}/Images/{type}`.
- Per-provider config (keep `PLEX_*`; add `JELLYFIN_*`/`EMBY_*`) with active-provider validation and safe secret handling.

**Non-Goals:**

- **Tautulli** — Plex viewing statistics only; it is not an artwork target, so it is not integrated.
- **Trakt** — watch-tracking; a possible future "item source" to build a library without a media server, deferred.
- No change to the Kometa YAML export, the job queue, or the SSE pipeline.
- No multi-server-at-once: exactly one active server type at a time (others' creds stay stored but inert).
- No image proxy/caching layer changes.

## Decisions

**1. A `MediaServer` interface with a factory keyed by server type.**
Define `interface MediaServer { testConnection(); listLibraries(); listItems(libraryId); applyPosterUrl(id, url); applyPosterBytes(id, bytes, contentType); applyBackgroundUrl(id, url); applyBackgroundBytes(id, bytes, contentType); lockField(id, field, locked); }` in `src/lib/server/media-server/types.ts`. A `getActiveProvider(config)` factory returns a constructed provider (credentials bound at construction) for `config.serverType`. Callers (sync, discover, apply) take a `MediaServer`, never a `baseUrl`/`token`.
_Alternatives:_ keep free functions and pass a `serverType` everywhere (rejected — leaks branching into every call site); a class hierarchy with inheritance (rejected — Jellyfin/Emby share via a parameterized base, Plex is standalone; composition over a shared `EmbyLikeProvider` is simpler than a 3-deep hierarchy).

**2. Refactor Plex behind the interface, preserving its quirks internally.**
The Plex provider wraps the existing `client.ts` logic unchanged (token in query string for writes, `thumb.locked`/`art.locked` for locking, `MediaContainer` parsing). These Plex-isms stay inside the provider and never appear in the interface, which speaks in neutral terms (`applyPosterUrl`, `lockField('poster'|'background')`). The existing `src/lib/server/plex/parse.ts` (+ its test) moves under the provider intact.
_Alternative:_ rewrite the Plex client from scratch (rejected — the current code is correct and tested; wrap, don't rewrite).

**3. One shared Emby-family implementation for Jellyfin and Emby.**
Jellyfin forked from Emby; their relevant endpoints match: auth via an `Authorization`/`X-Emby-Token`/`X-MediaBrowser-Token` header carrying the API key, `GET /System/Info` for identity, library + item listing via `/Items`, external ids in `ProviderIds` (`Tmdb`/`Imdb`/`Tvdb`), current art via `/Items/{id}/Images/Primary` and `/Backdrop`, and apply via `POST /Items/{id}/Images/{type}` with raw bytes (base64 body, content-type header). Implement one `EmbyLikeProvider(baseUrl, apiKey, flavor)` and parameterize the few differences (auth header name, identity field names). Locking is implicit — these servers do not auto-replace an explicitly set image — so `lockField` is a no-op that the interface still exposes for parity.
_Alternative:_ two fully separate providers (rejected — ~95% duplicate; one shared impl with a `flavor` flag is less code and less drift).

**4. Apply by bytes for Jellyfin/Emby; keep URL apply for Plex.**
Plex can fetch a poster from a URL server-side. Jellyfin/Emby's image endpoint takes raw bytes. So `applyPosterUrl` on the Emby-like provider fetches the URL into bytes first, then posts them; `applyPosterBytes` posts directly. Plex's `applyPosterUrl` keeps passing the URL to Plex as today. The interface stays uniform; the URL→bytes fetch is an implementation detail of the Emby-family provider.

**5. Plex PIN login as a small plex.tv client, token stored as the Plex credential.**
A `plex/auth.ts` module: `createPin()` → `POST https://plex.tv/api/v2/pins?strong=true` with headers `X-Plex-Product`, `X-Plex-Client-Identifier` (a stable per-install id, persisted in settings), returning `{ id, code, expiresAt, authToken: null }`; `pollPin(id)` → `GET https://plex.tv/api/v2/pins/{id}` until `authToken` is non-null or expiry passes. The UI shows `code` and the link `https://plex.tv/link` (or the auth URL with the client id). On success the token is saved via the existing `saveSettings({ plexToken })`. Polling runs from the client against a server route that proxies plex.tv (keeps the client id and product headers server-side and avoids CORS).
_Alternative:_ embed the plex.tv OAuth web flow (rejected — PIN flow is simpler, headless-friendly, and the documented path for non-browser clients).

**6. Connection discovery via plex.tv resources, surfaced as a picker.**
`plex/discovery.ts`: `GET https://plex.tv/api/v2/resources?includeHttps=1` with the token + client id; filter to `provides` containing `server`; map each `connections[]` entry to `{ uri, address, local, relay }`. The UI lists them grouped local-first; selecting one sets `plexUrl` after a `testConnection` against the chosen `uri`. Relay connections are flagged (slower) and offered last.

**7. Config gains `serverType` and per-provider creds; validation targets the active provider.**
Add `serverType: 'plex'|'jellyfin'|'emby'` (default `plex`), `jellyfinUrl`, `jellyfinApiKey`, `embyUrl`, `embyApiKey`, and a persisted `plexClientId`. Extend `ENV_MAP` (`SERVER_TYPE`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `EMBY_URL`, `EMBY_API_KEY`), `WRITABLE_KEYS`, `SECRET_KEYS` (add `jellyfinApiKey`, `embyApiKey`), and `PublicConfig` (add `*ApiKeySet` flags + `serverType`). `requireConfig` for sync/apply checks only the active provider's keys via a small `requiredKeysFor(serverType)` helper. `redact` already iterates `SECRET_KEYS`, so adding the new secrets covers logging.

## Risks / Trade-offs

- **Largest refactor in the codebase: every Plex caller moves to the interface.** → Land the provider + factory first with the Plex provider delegating to the unchanged `client.ts`, switch call sites one flow at a time (sync → discover → apply), and rely on the existing `parse.test.ts` plus a provider-level connection test to catch regressions. No behavior change is the acceptance bar for the Plex path.
- **Interface must not leak Plex-isms** (query-string token, `thumb.locked`) into Jellyfin/Emby. → The interface speaks neutral verbs (`applyPosterUrl`, `lockField`); locking is a no-op for Emby-family, URL apply is bytes-internally. Reviewed against all three providers before merge.
- **Jellyfin/Emby API drift between versions** (header name, image endpoint casing). → Centralize differences in the `flavor` parameter; a connection test against `/System/Info` validates auth early and surfaces a clear unauthorized-vs-unreachable result.
- **plex.tv PIN/resources are external and rate-limited.** → Poll with a backoff and a hard stop at the PIN's `expiresAt`; cache the client identifier; do discovery on demand, not on every settings load.
- **Secret sprawl** (now four server secrets). → All routed through `SECRET_KEYS`/`redact`/`publicConfig`, which already enforce no-echo and no-log; new keys just join those lists.
- **GUID/id shape differs** (Plex `ratingKey` + `Guid[]` vs Emby `Id` + `ProviderIds`). → The interface returns a normalized item (`{ id, title, year, type, guids, currentPosterUrl, currentBackgroundUrl }`); each provider maps its own shape, so downstream resolution/sync is unchanged.

## Migration Plan

1. Add config keys (`serverType`, `jellyfin*`, `emby*`, `plexClientId`) — all default-safe; existing `PLEX_*`/persisted Plex settings continue to work with `serverType` defaulting to `plex`. No DB migration needed beyond settings rows (key/value table already exists).
2. Introduce `media-server/` with the interface + factory and the Plex provider delegating to the existing `client.ts`; switch sync/discover/apply to the factory. Verify no behavior change for Plex.
3. Add the Emby-family provider (Jellyfin + Emby) and wire the factory branches.
4. Add the plex.tv `pins`/`resources` server routes and the Plex login + connection picker UI; add the server-type selector and Jellyfin/Emby credential fields to Settings.
5. Rollback: the factory still defaults to Plex; reverting the UI/routes leaves the Plex path intact. The added config keys are inert when unused.

## Open Questions

- Exact Jellyfin vs Emby auth header (`Authorization: MediaBrowser Token="…"` vs `X-Emby-Token`/`X-MediaBrowser-Token`) and image POST body encoding (base64 vs raw) — confirm against live servers during build; isolated in the `flavor` config.
- Whether to auto-run connection discovery immediately after a successful PIN login (one fewer click) vs. on explicit user action — default to auto-run, then let the user re-pick.
- Whether Kometa export stays Plex-only conceptually or is offered for Jellyfin/Emby users too (Kometa is Plex/PMM-oriented) — keep it available but documented as Plex/PMM-targeted.

## 1. Media server abstraction

- [x] 1.1 Define `MediaServer` interface and normalized types (`ServerLibrary`, `ServerItem` with `{ id, title, year, type, guids, currentPosterUrl, currentBackgroundUrl }`, `ConnectionResult`) in `src/lib/server/media-server/types.ts`
- [x] 1.2 Add `serverType` and a `getActiveProvider(config)` factory in `src/lib/server/media-server/index.ts` that constructs the provider for the active type and refuses (reporting missing creds) when its credentials are absent — implemented as `getActiveServer`/`resolveActiveServer` (returns `{ server, missing }`)

## 2. Plex provider refactor

- [x] 2.1 ~~Move `src/lib/server/plex/{client,parse}.ts` (+ `parse.test.ts`) under `src/lib/server/media-server/plex/`, unchanged~~ — PRAGMATIC DEVIATION: files left in place; `media-server/plex.ts` wraps the existing functions via `plexProvider(baseUrl, token)`. See design.md Implementation Notes.
- [x] 2.2 Implement a `PlexProvider` that adapts the existing functions to the `MediaServer` interface (testConnection, listLibraries, listItems, applyPosterUrl/Bytes, applyBackgroundUrl/Bytes, lockField via `thumb.locked`/`art.locked`) — background apply (`arts` endpoint, `art.locked`) added to `plex/client.ts`
- [x] 2.3 Switch the sync, discover, and apply flows to obtain a `MediaServer` from the factory instead of importing Plex functions directly (sync in `jobs/tasks.ts`; apply/custom-upload/revert in `posters/service.ts`; the settings test + sections routes + settings load)
- [x] 2.4 Verify no behavior change for an existing Plex setup (connection test, list, apply, lock) — `parse.test.ts` unchanged and passing; `service.test.ts` updated to the provider interface; `check`/`test`/`build` clean. (Live Plex run not performed in this environment — manual smoke test recommended.)

## 3. Jellyfin / Emby provider

- [x] 3.1 Implement a shared `embyLikeProvider(baseUrl, apiKey, flavor)`: identity via `GET /System/Info`, libraries via `/Library/MediaFolders`, items via `/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds` (mapping `ProviderIds` → tmdb/imdb/tvdb), current art via `/Items/{id}/Images/{Primary|Backdrop}` — pure mapping in `emby-parse.ts`
- [x] 3.2 Implement apply: `applyPosterBytes`/`applyBackgroundBytes` via `POST /Items/{id}/Images/{Primary|Backdrop}` (base64 body + image content-type); `applyPosterUrl`/`applyBackgroundUrl` fetch the URL to bytes first; `lockField` is a no-op
- [x] 3.3 Parameterize Jellyfin vs Emby differences (auth header) behind the `flavor` flag and wire both into the factory (Jellyfin `Authorization: MediaBrowser Token="…"`; Emby `X-Emby-Token`; both also send `X-MediaBrowser-Token`)
- [x] 3.4 Connection test distinguishes unauthorized (401/403 → `unauthorized: true`) from unreachable (network) and returns server name/version
- [ ] 3.5 (manual / live-only) Verify against real Jellyfin and Emby servers — image POST body encoding (base64 vs raw) and exact auth header confirmed per docs but not yet exercised against live instances; isolated behind `flavor` for adjustment.

## 4. Plex login + discovery

- [x] 4.1 Add `media-server/plex-auth.ts`: `createPin(clientId)` (`POST plex.tv/api/v2/pins?strong=true`) and `pollPin(id, clientId)` with a stable persisted `plexClientId` (`ensurePlexClientId`) and product headers; the route stops at PIN expiry
- [x] 4.2 Add `media-server/plex-auth.ts#listConnections(token, clientId)` (`GET plex.tv/api/v2/resources?includeHttps=1`) returning `{ serverName, uri, address, local, relay, https }[]`, requiring a token; pure parser in `plex-auth-parse.ts`
- [x] 4.3 Add server routes: create PIN (`POST /api/plex/pin`), poll PIN (`GET /api/plex/pin/[id]`, stores token on success), and discover connections (`GET /api/plex/connections`) — all proxy plex.tv with the client id/headers server-side

## 5. Configuration

- [x] 5.1 Extend `AppConfig`/config module with `serverType`, `jellyfinUrl`, `jellyfinApiKey`, `embyUrl`, `embyApiKey`, `plexClientId`; add to `ENV_MAP` (`SERVER_TYPE`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `EMBY_URL`, `EMBY_API_KEY`, `PLEX_CLIENT_ID`) and `WRITABLE_KEYS`
- [x] 5.2 Add `jellyfinApiKey`/`embyApiKey` to `SECRET_KEYS`; add `serverType` + `*ApiKeySet` flags to `PublicConfig`/`publicConfig`
- [x] 5.3 Add `requiredKeysFor(serverType)` (+ `requireActiveServer`) and make sync/apply validate only the active provider's credentials

## 6. Settings UI

- [x] 6.1 Add a server-type selector (Plex / Jellyfin / Emby) that swaps the visible credential fields and persists the active type
- [x] 6.2 Add a Plex "Log in" button + PIN flow (shows code and plex.tv link, polls `/api/plex/pin/[id]` until the token is set without revealing it)
- [x] 6.3 Add a Plex connection picker populated from `/api/plex/connections` (local-first, relay flagged); selecting one sets `plexUrl` (tested via "Test connections" before saving)
- [x] 6.4 Add Jellyfin/Emby base URL + API key fields; "Test connections" reports unauthorized vs unreachable for the active provider

## 7. Validation

- [x] 7.1 Run `openspec validate "multi-server-support"` and fix until valid — valid
- [x] 7.2 Verify the four artifacts cross-reference correctly (proposal capabilities ↔ spec files ↔ design decisions ↔ tasks)

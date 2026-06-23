## 1. Media server abstraction

- [ ] 1.1 Define `MediaServer` interface and normalized types (`ServerLibrary`, `ServerItem` with `{ id, title, year, type, guids, currentPosterUrl, currentBackgroundUrl }`, `ConnectionResult`) in `src/lib/server/media-server/types.ts`
- [ ] 1.2 Add `serverType` and a `getActiveProvider(config)` factory in `src/lib/server/media-server/index.ts` that constructs the provider for the active type and refuses (reporting missing creds) when its credentials are absent

## 2. Plex provider refactor

- [ ] 2.1 Move `src/lib/server/plex/{client,parse}.ts` (+ `parse.test.ts`) under `src/lib/server/media-server/plex/`, unchanged
- [ ] 2.2 Implement a `PlexProvider` that adapts the existing functions to the `MediaServer` interface (testConnection, listLibraries, listItems, applyPosterUrl/Bytes, applyBackgroundUrl/Bytes, lockField via `thumb.locked`/`art.locked`)
- [ ] 2.3 Switch the sync, discover, and apply flows to obtain a `MediaServer` from the factory instead of importing Plex functions directly
- [ ] 2.4 Verify no behavior change for an existing Plex setup (connection test, list, apply, lock) against the `parse.test.ts` suite and a manual run

## 3. Jellyfin / Emby provider

- [ ] 3.1 Implement a shared `EmbyLikeProvider(baseUrl, apiKey, flavor)`: identity via `GET /System/Info`, libraries + items via `/Items` (mapping `ProviderIds` → tmdb/imdb/tvdb), current art via `/Items/{id}/Images/{type}`
- [ ] 3.2 Implement apply: `applyPosterBytes`/`applyBackgroundBytes` via `POST /Items/{id}/Images/{Primary|Backdrop}`; `applyPosterUrl`/`applyBackgroundUrl` fetch the URL to bytes first; `lockField` is a no-op
- [ ] 3.3 Parameterize Jellyfin vs Emby differences (auth header, image body encoding) behind the `flavor` flag and wire both into the factory
- [ ] 3.4 Connection test distinguishes unauthorized (bad API key) from unreachable (network) and returns server name/version

## 4. Plex login + discovery

- [ ] 4.1 Add `media-server/plex/auth.ts`: `createPin()` (`POST plex.tv/api/v2/pins?strong=true`) and `pollPin(id)` with a stable persisted `plexClientId` and product headers; stop at expiry
- [ ] 4.2 Add `media-server/plex/discovery.ts`: `listConnections(token)` (`GET plex.tv/api/v2/resources?includeHttps=1`) returning `{ serverName, uri, address, local, relay }[]`, requiring a token
- [ ] 4.3 Add server routes: create PIN, poll PIN (stores token on success), and discover connections (proxying plex.tv with the client id/headers server-side)

## 5. Configuration

- [ ] 5.1 Extend `AppConfig`/config module with `serverType`, `jellyfinUrl`, `jellyfinApiKey`, `embyUrl`, `embyApiKey`, `plexClientId`; add to `ENV_MAP` (`SERVER_TYPE`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `EMBY_URL`, `EMBY_API_KEY`) and `WRITABLE_KEYS`
- [ ] 5.2 Add `jellyfinApiKey`/`embyApiKey` to `SECRET_KEYS`; add `serverType` + `*ApiKeySet` flags to `PublicConfig`/`publicConfig`
- [ ] 5.3 Add `requiredKeysFor(serverType)` and make `requireConfig` for sync/apply validate only the active provider's credentials

## 6. Settings UI

- [ ] 6.1 Add a server-type selector (Plex / Jellyfin / Emby) that swaps the visible credential fields and persists the active type
- [ ] 6.2 Add a Plex "Log in" button + PIN modal (shows code and plex.tv link, polls until the token is set without revealing it)
- [ ] 6.3 Add a Plex connection picker populated from discovery (local-first, relay flagged), testing the chosen URI before saving it as `plexUrl`
- [ ] 6.4 Add Jellyfin/Emby base URL + API key fields with an inline connection test, reporting unauthorized vs unreachable

## 7. Validation

- [ ] 7.1 Run `openspec validate "multi-server-support"` and fix until valid
- [ ] 7.2 Verify the four artifacts cross-reference correctly (proposal capabilities ↔ spec files ↔ design decisions ↔ tasks)

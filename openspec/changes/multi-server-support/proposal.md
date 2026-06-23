## Why

PosterPilot is hard-wired to Plex, and even its Plex support is bare: the only way to connect is to paste an `X-Plex-Token` and a single manually-typed server URL — there is no way to log in or to discover a reachable server address. Jellyfin and Emby users are excluded entirely. Generalizing the app behind a media-server abstraction lets the same browse/discover/apply pipeline drive Plex, Jellyfin, and Emby, and a proper Plex PIN login plus connection discovery removes the most error-prone part of setup (finding a token and a working URL).

## What Changes

- **Introduce a `MediaServer` provider interface** that captures everything the rest of the app needs from a media server: test the connection, list libraries/sections, list items (with external GUIDs and current artwork URLs), upload a poster, set a background/art image, and lock a field so the server's agents do not overwrite it.
- **Refactor the Plex-specific code** (`src/lib/server/plex/*`) into the **Plex provider** behind that interface. Existing Plex behavior is preserved; callers stop importing Plex directly and instead use the active provider.
- **Add Jellyfin and Emby providers** behind the same interface. Their HTTP APIs are near-identical to each other; both authenticate with an API key + base URL and apply artwork via `POST /Items/{id}/Images/{type}`.
- **Add Plex PIN-based login** that *acquires* a token via plex.tv: `POST https://plex.tv/api/v2/pins?strong=true` returns a code and id; the user is shown the code / auth link, and the app polls the pin id until an `authToken` appears, then stores it. (Today no token-acquire flow exists at all.)
- **Add Plex connection discovery** via `GET https://plex.tv/api/v2/resources?includeHttps=1`, which lists the user's servers and each connection tagged local vs remote (`local: true/false`, `relay`, `uri`/`address`). The user picks a local or remote URL from a list instead of typing one.
- **Make configuration server-type aware**: choose the active server type (`plex` | `jellyfin` | `emby`); keep `PLEX_*`, add `JELLYFIN_*` and `EMBY_*` (base URL + API key) credentials.
- **Apply covers through the active provider** rather than calling Plex directly, while keeping Kometa export unchanged (it stays a Plex/PMM-oriented YAML target).
- **Settings UI** gains a server-type selector, a Plex "Log in" button (PIN flow), and a local/remote connection picker for Plex.

**Non-Goals (explicit):** Tautulli (Plex viewing *stats* only — it is not an artwork target, so it is skipped) and Trakt (watch-tracking; a possible future "item source" for building a library without a media server, deferred) are out of scope for this change.

## Capabilities

### New Capabilities

- `media-server`: The provider abstraction (a `MediaServer` interface) plus the Plex, Jellyfin, and Emby providers; the Plex token-acquire PIN login; and Plex connection discovery with local/remote connection selection.

### Modified Capabilities

- `plex-integration`: Plex becomes one provider implementing the `media-server` interface; adds the PIN-based token-acquire login and plex.tv connection discovery (local/remote) on top of the existing connect/list/apply/lock behavior.
- `configuration`: Add an active server-type selection and per-provider credentials — keep `PLEX_*`, add `JELLYFIN_*` and `EMBY_*` (base URL + API key); validate the *active* provider's credentials.
- `poster-application`: Direct apply and field-locking go through the active server provider rather than Plex specifically; Kometa export is unchanged.
- `web-ui`: Settings gains a server-type selector, a Plex "Log in" (PIN) button, and a local/remote connection picker.

## Impact

- **New module:** `src/lib/server/media-server/` — the `MediaServer` interface, a provider factory keyed by server type, and `plex/` (refactored), `jellyfin/`, `emby/` providers, plus plex.tv `pins`/`resources` clients.
- **Schema/config:** new config keys for `serverType` and `JELLYFIN_*`/`EMBY_*`; `requireConfig`/`publicConfig`/secret handling extended for the new secrets (Jellyfin/Emby API keys); env map additions.
- **Endpoints:** new server routes for Plex PIN create/poll and connection discovery; the connection-test/list/apply routes call the active provider.
- **UI:** Settings page server-type selector, Plex login button + PIN modal, connection picker; existing single-URL/token inputs become Plex-provider fields.
- **External calls:** plex.tv `pins` (create + poll) and `resources` (discovery), plus Jellyfin/Emby `Items`/`Images` endpoints.
- **Refactor risk (largest change):** every current caller of `src/lib/server/plex/*` (sync, discover, apply) must move to the provider interface; the abstraction must cover Plex's quirks (token in query string, `thumb.locked`) without leaking Plex-isms into the Jellyfin/Emby providers. Called out in `design.md`.

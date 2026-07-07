## Why

On a large library (1200+ items) the `/library` page is slow to load, the page transition
lags, and posters fill in only after the page appears. Diagnosis found **two independent
causes**, neither of which is fixed by the existing cache:

1. **No pagination.** `listLibrary` (`src/lib/server/queries.ts:67`) runs
   `db.select().from(mediaItems)` with **no `LIMIT`**, so `library/+page.server.ts` serializes
   **all** rows into the SSR page payload. SvelteKit's `load` must complete and ship the whole
   blob before the View Transition finishes → slow transition and long first paint.
2. **Grid posters load straight from the media server.** `PosterCard.svelte` renders
   `<img src={item.currentPosterUrl}>`, and `currentPosterUrl` is a **Plex/Emby** URL
   (`plex/client.ts:221` `buildPosterUrl(base, thumb, token)`), full-resolution with the token in
   the URL. 1200 cards fetch full-size posters directly from the media server — no resize, no
   local cache. The existing `/api/thumb` proxy caches only the **provider CDNs**
   (`tmdb.org`/`mediux.pro`/`fanart.tv`/`theposterdb.com`) and deliberately excludes the media
   server (SSRF allow-list), so the grid can't use it today.

These are the two library follow-ups deferred from the auth/hardening PR.

## What Changes

- **Paginate / virtualize the library grid.** Add `LIMIT`/`OFFSET` (or keyset) paging to
  `listLibrary` and a total count; the page loads a first window (~60 items) and loads more on
  scroll (infinite scroll or windowed rendering), so the SSR payload is bounded.
- **Cache + resize media-server posters for the grid.** Serve grid posters through a cached,
  resized thumbnail endpoint (extend `/api/thumb` to accept the active media server as a trusted
  host, or add a dedicated `/api/poster-thumb` that fetches via the server client). Point
  `PosterCard` at it. Add `decoding="async"` + intrinsic `width`/`height` to reduce layout cost.

**Out of scope:** changing what artwork is shown; provider-side behavior; the auth/hardening work.

## Capabilities

### New Capabilities
- `library-thumbnails`: a server-side, cached, resized poster-thumbnail endpoint keyed by item id.
  It resolves the media-server poster URL **server-side** (so the token/api_key never reaches the
  client — an improvement over today, where `currentPosterUrl` ships to the browser with the token
  in it), requests a grid-sized image from the media server itself (Plex photo transcode /
  Emby-Jellyfin `fillWidth`, so no image-processing dependency), and caches the bytes via the
  existing thumbnail cache. No client-supplied URL, so no SSRF surface.

### Modified Capabilities
- `web-ui`: the library grid renders a bounded, paged set and loads more on demand (infinite
  scroll), instead of serializing every row into one SSR payload; poster images are served from the
  new cached thumbnail endpoint (with `decoding="async"` + intrinsic dimensions) rather than the raw
  media-server URL.

## Impact

- **Server:** `queries.ts` (`listLibrary` gains paging + a count); `library/+page.server.ts`
  (window + total); the thumb-cache path (`posters/thumb-cache.ts`, `api/thumb` or a new route)
  extended to the media server with the token kept server-side.
- **UI:** `library/+page.svelte` (infinite scroll / windowing, loading states); `PosterCard.svelte`
  (thumb URL + `decoding`/dimensions).
- **Perf:** bounded SSR payload; far smaller, cached, resized poster bytes on the grid.
- **Security:** the media-server thumb path must keep the token server-side and stay SSRF-guarded.

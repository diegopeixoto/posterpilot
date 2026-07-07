## Context

On a large library (1200+ items) `/library` is slow to load, the page transition lags, and posters
fill in only after the page appears. Two independent causes were confirmed against the code:

1. **No pagination.** `listLibrary` (`src/lib/server/queries.ts:67`) is `db.select().from(mediaItems)`
   with **no `LIMIT`**; `library/+page.server.ts` serializes every row into the SSR payload, so the
   SvelteKit `load` must finish and ship the whole blob before the View Transition completes.
2. **Grid posters load straight from the media server.** `PosterCard.svelte` renders
   `<img src={item.currentPosterUrl}>`, and `currentPosterUrl` is a full-resolution **Plex/Emby**
   URL with the token/api_key embedded (`plex/client.ts:221` `buildPosterUrl`, and the Emby
   `/Items/<id>/Images/Primary?...&api_key=…` form). 1200 cards fetch full-size posters directly from
   the media server — no resize, no local cache. The existing `/api/thumb` proxy caches only the
   provider CDNs (SSRF allow-list) and deliberately excludes the media server.

Existing machinery to reuse:
- `thumb-cache.ts` — `getOrFetchThumb(url, { ttlMs, maxBytes })` caches image **bytes** on disk with
  TTL + LRU eviction (pure helpers unit-tested). It stores raw bytes; it does not resize.
- The Settings **Activity** tab already implements infinite scroll (`loadEvents({ before })` cursor),
  a pattern the library grid can mirror.

## Goals / Non-Goals

**Goals:**
- Bound the SSR payload: load a first window (~60 items) and fetch more on scroll.
- Serve grid posters from a **cached, grid-sized** image, keeping the media-server token
  **server-side** (a security improvement over shipping `currentPosterUrl` to the client).
- No new heavyweight dependency; reuse the existing thumbnail cache.

**Non-Goals:**
- Full windowing/virtualization of the DOM (infinite scroll with capped batches is enough for now;
  true virtual scrolling can follow if needed).
- Changing which artwork is shown, provider behavior, or the apply flow.
- Backfilling thumbnails proactively — they populate lazily on first grid view.

## Decisions

### Pagination — keyset over the active sort, not OFFSET
`listLibrary` gains a bounded page. Prefer a **keyset cursor** over the current sort column + id
tiebreaker (stable under inserts, no large-OFFSET scan) with a `limit` (default ~60) and returns
`{ items, nextCursor }`. `library/+page.server.ts` returns the first page; a client `loadMore`
appends via a small `/api/library` endpoint (mirroring the Activity tab's `before`-cursor infinite
scroll). Filters/sort already parsed in the load are threaded into the paged query and the endpoint.

Alternative considered: `LIMIT/OFFSET` + a `count(*)` total. Simpler, and 1200 rows is not huge, but
OFFSET degrades on deep scroll and a changing list can skip/duplicate rows. Keyset is the better fit
and the Activity tab already establishes the cursor pattern. (If keyset proves fiddly for some sorts,
OFFSET is an acceptable fallback — captured as an open question.)

### Poster thumbnails — a server-side proxy keyed by item id
Add `GET /api/poster-thumb/[id]` (grid poster) that:
1. Looks up the item **server-side** and resolves its media-server poster URL (with token) — the
   client only ever passes an **item id**, never a URL, so there is **no SSRF surface** and the token
   never reaches the browser (an improvement: today `currentPosterUrl` ships to the client).
2. Requests a **grid-sized** render from the media server itself — Plex `/photo/:/transcode?width=…`,
   Emby/Jellyfin `…/Images/Primary?...&fillWidth=…` — so resizing is done upstream and needs **no
   image-processing dependency** (no `sharp`).
3. Caches the resized bytes via `getOrFetchThumb`, keyed by a cache URL that includes the item +
   target width, and serves them with long-lived immutable cache headers.

`PosterCard.svelte` switches `src` to `/api/poster-thumb/<id>` and gains `decoding="async"` plus
intrinsic `width`/`height` (2:3) to cut layout cost. A missing poster falls back to the existing
"no poster" placeholder.

Alternative considered: add `sharp` and resize in-process. Rejected — a native dependency enlarges
the image and the build, when the media servers already resize on request. Alternative considered:
extend `/api/thumb`'s allow-list to the media server. Rejected — that keeps the client-supplied-URL
(SSRF) shape and leaves the token on the client; the id-keyed route is strictly safer.

### Auth interaction
`/api/poster-thumb/[id]` is under `/api/*`, so the auth guard (from the auth change) already gates it
when auth is enabled — grid posters require a session exactly like the rest of the app. No extra work.

## Risks / Trade-offs

- **Media-server resize params differ per server** → Plex transcode vs Emby/Jellyfin `fillWidth`
  need per-backend URL construction. Mitigation: build it behind the existing media-server
  abstraction; fall back to the full-size URL (still cached) if a backend can't resize.
- **First grid view is still a burst of misses** → the first render fetches+caches N posters. Cache
  makes every subsequent visit fast; the burst is bounded by the page size and the media server's own
  resize is cheap. Acceptable.
- **Keyset cursor complexity across sort modes** → some sorts (rating/runtime with nulls) need a
  careful tiebreaker. Mitigation: cursor encodes (sortValue, id); OFFSET fallback if needed.
- **Cache churn** → resized posters share the existing 512 MB LRU budget with provider thumbs. If
  contention shows up, the budget is already configurable (`THUMB_CACHE_MAX_MB`).

## Migration Plan

No schema change required (paging is query-only; thumbnails reuse the existing `thumbnail_cache`
table). Ship behind no flag — the grid simply loads faster and posters route through the new
endpoint. Old bookmarks/URLs with filters still work (filters are unchanged query params).

## Open Questions

- Page size default (proposed ~60) — tune against a real 1200-item library.
- Keyset vs OFFSET for the paged query — keyset preferred; confirm it's clean across all six sorts.
- Grid target width for the resized poster (e.g. 300–360px CSS → 2x for retina) — pick against the
  actual grid cell size.
- Should the item-detail page also route its poster/candidates through a cache, or is the grid the
  only hot path? (Proposed: grid only for now.)

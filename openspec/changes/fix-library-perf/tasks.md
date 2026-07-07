## 1. Paged library query

- [ ] 1.1 Extend `listLibrary` (`queries.ts`) with a bounded page: a `limit` (default ~60) and a keyset cursor over the active sort column + `id` tiebreaker; return `{ items, nextCursor }`. Keep all existing filters/sort.
- [ ] 1.2 Unit-test the cursor encode/decode + the "order + tiebreaker" logic as a pure helper (`$env`-free), across all six sorts including null-bearing ones (rating/runtime/date-added).
- [ ] 1.3 `GET /api/library` endpoint — same filter/sort query params as the page, plus `cursor`; returns `{ items, nextCursor }`. Gated by the auth guard automatically (under `/api/*`).

## 2. Library page — first page + infinite scroll

- [ ] 2.1 `library/+page.server.ts` — return only the first page (`items`, `nextCursor`) alongside genres/spotlight; keep the parallel `Promise.all`.
- [ ] 2.2 `library/+page.svelte` — append pages via the Activity-tab infinite-scroll pattern (`loadMore(cursor)`), preserving filters/sort; add a loading state and end-of-list handling. Reset on filter/sort change.
- [ ] 2.3 Verify a filter/sort change re-queries from the first page (no stale cursor).

## 3. Poster-thumbnail endpoint

- [ ] 3.1 Media-server resize URL: add a per-backend helper to build a grid-sized image URL (Plex `/photo/:/transcode?width=…`, Emby/Jellyfin `…/Images/Primary?...&fillWidth=…`) behind the media-server abstraction; fall back to the full-size URL when unsupported. Unit-test the URL builders.
- [ ] 3.2 `GET /api/poster-thumb/[id]` — look up the item server-side, resolve its (token-bearing) poster URL, request the resized render, cache via `getOrFetchThumb` (cache key = item + target width), serve with immutable cache headers; 404/placeholder path when no poster.
- [ ] 3.3 Confirm the token/api_key never appears in the response or client payload (server-side resolution only).

## 4. Grid rendering

- [ ] 4.1 `PosterCard.svelte` — switch `<img src>` to `/api/poster-thumb/<id>`; add `decoding="async"` + intrinsic `width`/`height` (2:3); keep `loading="lazy"` and the no-poster placeholder.
- [ ] 4.2 Stop shipping raw `currentPosterUrl` to the grid client where it's only used for the tile image (keep it server-side / for apply paths).

## 5. Verification

- [ ] 5.1 Gates: `bun run check` (0 errors), `bun run test`, `bun run build`, `bun run lint`.
- [ ] 5.2 Measure: first `/library` paint + payload size on a large library before/after; confirm the grid loads a bounded page and appends on scroll.
- [ ] 5.3 Confirm posters are served from `/api/poster-thumb` (cache hit on revisit; no media-server token in the client payload); missing-poster placeholder still renders.

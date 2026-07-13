## 1. Paged library query

- [x] 1.1 `listLibrary` gained a bounded page (`{ limit, offset }`) + `countLibrary`; shared `libraryConds` helper; stable order (sort + `id` tiebreaker). **Used OFFSET, not keyset** — the design flagged it as the acceptable fallback, and it's the right fit given `recent` (subquery) and nullable sorts.
- [x] 1.2 Filter parsing extracted to a pure `$lib/library-filter.ts` (shared by page + endpoint). (Cursor helper not needed — OFFSET.)
- [x] 1.3 `GET /api/library` — same filter/sort params + `offset`; returns `{ items, total }`; gated by the auth guard (under `/api/*`).

## 2. Library page — first page + infinite scroll

- [x] 2.1 `library/+page.server.ts` returns only the first page + `total` + `pageSize`; keeps the parallel `Promise.all`.
- [x] 2.2 `library/+page.svelte` accumulates pages (`items` state), `loadMore` via `/api/library`, IntersectionObserver sentinel (600px prefetch) + manual button + error state; i18n added to all 5 catalogs.
- [x] 2.3 Re-seed `$effect` resets the accumulator when the SSR payload changes (filter/sort navigation).

## 3. Poster-thumbnail endpoint

- [x] 3.1 `resizedPosterUrl` (pure, tested): Emby/Jellyfin `fillWidth` resize; Plex/unknown → full-size (cached). Plex transcode deferred (fragile to build offline; caching still applies).
- [x] 3.2 `GET /api/poster-thumb/[id]` — resolves the item's poster URL server-side, caches via `getOrFetchThumb` (TTL + LRU from config), serves with immutable cache headers; 404 on no poster.
- [x] 3.3 Browser no longer fetches the media server directly (served by id via the proxy); the library SSR/API projection exposes only `hasPoster`/`hasStagedPoster` and a safe cache version, never media-server or provider URLs.

## 4. Grid rendering

- [x] 4.1 `PosterCard` `<img src>` → `/api/poster-thumb/<id>` + `decoding="async"` + intrinsic `width`/`height`; keeps `loading="lazy"` and the no-poster placeholder.
- [x] 4.2 Library grid payloads use the credentials-safe projection; tests reject serialization of current/staged artwork URLs or token-like values.

## 5. Verification

- [x] 5.1 Gates: `bun run check` (0 errors), `bun run test` (349 pass incl. new poster-thumb tests), `bun run build`, `bun run lint`.
- [ ] 5.2 Measure first `/library` paint + payload before/after on a real large library (manual, needs the running container).
- [ ] 5.3 Confirm cache hit on revisit + missing-poster placeholder in the running app (manual).

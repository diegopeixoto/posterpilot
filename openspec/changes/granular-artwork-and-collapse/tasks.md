## 1. Schema & migration

- [x] 1.1 Add `child_selections` table to `src/lib/server/db/schema.ts` (`mediaItemId` FK cascade, `kind` enum `poster|background|title_card`, `season`, `episode` nullable, `url`, `updatedAt`) with a unique index on `(mediaItemId, kind, season, episode)`; export inferred types.
- [x] 1.2 Add nullable `kind` / `season` / `episode` columns to `applied_posters` (null = show-level).
- [x] 1.3 Generate the Drizzle migration and verify it applies cleanly to a fresh and an existing DB.

## 2. Media-server provider: children

- [x] 2.1 Extend the `MediaServer` interface (`src/lib/server/media-server/types.ts`) with `listSeasons(showId)`, `listEpisodes(seasonId)`, and a child-image apply that targets a child id (poster/background/title-card) + lock; widen `LockField` as needed. (Reused existing `applyPosterUrl`/`applyBackgroundUrl`/`lockField` which already take an arbitrary id — only child listing + `ServerChild` were added.)
- [x] 2.2 Implement children listing + child-image apply for Plex (`/library/metadata/{key}/children`, upload to child rating key) in `src/lib/server/plex/client.ts` and its provider adapter.
- [x] 2.3 Implement children listing + child-image apply for Jellyfin/Emby (`/Items?ParentId=…&IncludeItemTypes=Season|Episode`, `POST /Items/{childId}/Images/{type}`) in `src/lib/server/media-server/emby.ts`.

## 3. Number-matching & apply/revert service

- [x] 3.1 Add a pure module that maps staged child selections to server children by season/episode number, returning matched pairs and unmatched (skipped) slots; unit-test it ($env-free).
- [x] 3.2 Extend `posters/service.ts` apply to read show + `child_selections` from the DB and apply every staged slot (direct: resolve children via §3.1, upload+lock per child, isolate per-child failures, collect skipped; record each in history with kind/season/episode).
- [x] 3.3 Extend revert to support full scope (show + all children) and per-season scope (season poster/background + its episode title cards), re-resolving children by number.

## 4. Kometa YAML export

- [x] 4.1 Extend `src/lib/server/kometa/yaml.ts` input + builder to emit nested `seasons: { N: { url_poster } }` and `episodes` title cards keyed by number; omit season background; keep show-level entry idempotent.
- [x] 4.2 Unit-test the builder for show-only, season-poster, and episode-title-card cases (and that season background is omitted).

## 5. Selection + apply/revert API

- [x] 5.1 Extend the select route (`/api/items/[id]/select`) to upsert/delete a child slot (`kind`, `season`, `episode`, `url`).
- [x] 5.2 Update `queries.ts` `getItemDetail` to return persisted child selections so the UI can hydrate staged state.
- [x] 5.3 Wire the apply route to the extended service (single apply writes all staged slots) and return per-slot outcomes including skipped slots. (No route change needed — `applyToItem` reads staged child slots from the DB and returns `children` summaries in each outcome.)
- [x] 5.4 Extend the revert route to accept an optional `season` scope.

## 6. Item-page UI

- [x] 6.1 Add a pure helper to group a set's candidates into show + per-season groups (season poster/background + that season's episode title cards); unit-test it.
- [x] 6.2 Render show group + per-season groups; make each season/episode slot independently selectable+staged (own highlight), persisting via the extended select route.
- [x] 6.3 Make "use this set" stage every covered slot by number, with per-slot override.
- [x] 6.4 Update the sticky builder to summarize staged slots (show + season/episode counts) and apply everything staged in one action.
- [x] 6.5 Add collapse toggles to provider sections, set cards, and season groups; default first-provider + first-set expanded, rest collapsed; persist open/closed in localStorage keyed by provider/set/season (pure default-seeding helper unit-tested).
- [x] 6.6 Add a per-season revert control in each season group plus the existing revert-all.

## 7. i18n

- [x] 7.1 Add all new message keys (season/episode labels, staged summary, collapse, per-season revert, skipped-slot notices) to every `messages/*.json` catalog (en/es/zh/ja/pt-BR) at parity.

## 8. Quality gates

- [x] 8.1 `bun run check` (0 errors), `bun run test` (235 pass), `bun run build`, `bun run lint` (src + messages clean) all pass.
- [ ] 8.2 Manual verify in a rebuilt container: stage show + season + episode, apply (direct + Kometa), confirm child art on the server and nested YAML; revert one season and revert all; confirm collapse defaults + persistence. (Requires the maintainer's live media server + `docker compose up -d --build`; not runnable in this environment.)

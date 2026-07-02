# Design — add-fun-menu

## Context

PosterPilot syncs the media server's movie/show libraries into a local `media_items` table (`src/lib/server/db/schema.ts:6-44`) with `type`, `year`, `genres` (JSON array), rating, posters, and overview — everything the picker needs except **watched status**, which is tracked nowhere (not in the schema, not in `ServerItem`, not fetched by any provider). Settings are a key/value table surfaced through a single config module (`src/lib/server/config/index.ts`) with env-override precedence. Navigation is a `$derived` links array in `src/routes/+layout.svelte:52-57` fed by `+layout.server.ts`. The library page (`src/routes/library/+page.svelte`) is the established pattern for filter UIs (Popover, selects, native checkboxes, chips), and `queries.ts` already has both a `json_each`-based genre filter (`listLibrary`, lines 76-79) and `ORDER BY random()` selection (`getMontagePosters`, lines 119-127).

## Goals / Non-Goals

**Goals:**

- Opt-in Fun section: hidden nav + inaccessible route unless `funEnabled` is on (default off).
- Random picker over the **local** synced library with type / genre / year-range / watched filters, instant re-roll.
- Watched status and server date-added captured during normal library sync for all three server types.
- Library grid sortable by date added, with the grid's default sort configurable (`libraryDefaultSort`).
- Full i18n parity (en/es/zh/ja/pt-BR), design-system-consistent UI (dark, violet accent, image-forward result card).
- Hand-written, user-facing release notes for the shipped version (v0.6.0 style).

**Non-Goals:**

- No live media-server queries at pick time.
- No per-user watched state (PosterPilot is single-user; watched = the configured server account).
- No episode-level picking (movies and whole shows only).
- No other Fun tools yet — this establishes the section with one tool.
- No weighting/recommendation logic — uniform random.

## Decisions

### 1. Watched status: capture at sync time into a new `media_items.watched` column

**Chosen:** extend `ServerItem` with `watched?: boolean`; each provider maps it (Plex: movie `viewCount > 0`, show `viewedLeafCount >= leafCount`; Jellyfin/Emby: `UserData.Played`). Sync persists it to a new `watched` integer-boolean column (default 0). Unknown/missing → unwatched.

**Alternative rejected:** live server query at pick time — adds latency and a hard server dependency to a toy feature, and duplicates filtering logic the local table already does well. Trade-off accepted: watched data is only as fresh as the last sync (consistent with everything else in the app).

### 2. Gate is a standard config boolean, enforced server-side

`funEnabled` goes through the canonical 6-touchpoint config pattern (AppConfig, `ENV_MAP: FUN_ENABLED`, `DEFAULTS: false`, `WRITABLE_KEYS`, `resolveConfig` via `toBool`, `PublicConfig`/`publicConfig`). `+layout.server.ts` exposes it; the nav array conditionally includes the Fun link. `src/routes/fun/+page.server.ts` throws a 404 when disabled — hiding the link alone is not a gate.

**Alternative rejected:** separate feature-flags table — over-engineering for one boolean; the settings table already does env-override + persistence.

### 3. Picker is a server `load` + URL-param filters, one new query function

New `pickRandomItem(filter)` in `queries.ts` composing the existing patterns: conds for `type`, `json_each` genre match, `gte/lte` on `year`, `eq(watched, false)` when excluding watched; `ORDER BY random() LIMIT 1`. Filters live in URL search params (like the library page) so a pick is shareable/refreshable; the "pick" action is a link/`goto` with a changing nonce param rather than client-side state. `ignored` items stay eligible — `ignored` is a poster-management concept, not a watch-list one.

**Alternative rejected:** dedicated `/api/fun/pick` endpoint + client fetch — more moving parts for no benefit; SvelteKit load already handles this.

### 4. Settings toggle lives in the existing "advanced" tab

Same native-checkbox pattern as `suggestPreselect`/`incrementalSync` (settings page lines 749-758), stringified into the existing `/api/settings` save payload. No new tab for one toggle.

### 5. Result presentation

Image-forward card: poster (fallback placeholder), title, year, type badge, genres, rating, overview — consistent with `.surface`/`.badge`/`.chip` tokens — plus a link to `/item/[id]` and a prominent re-roll button. Empty-match state gets its own localized message.

### 6. Date-added sort: new `added_at` column + `added` sort value, default sort from config

Same sync-time capture as watched (decision 1): `ServerItem` gains `addedAt: Date | null` (Plex `addedAt` epoch; Jellyfin/Emby `DateCreated`, mapped in `emby-parse.ts` beside the existing `DateLastModified` handling), persisted to a nullable `added_at` timestamp column in the same migration. `LibrarySort` gains `'added'` (natural direction `desc` — newest first — per `defaultSortDir`'s non-title rule); `orderFor` sorts nulls last so pre-resync rows don't float to the top. A new `libraryDefaultSort` setting (default `'title'`, env `LIBRARY_DEFAULT_SORT`, validated against the sort list — invalid/unset falls back to `title`) feeds the library loader: URL `sort` param wins, config default applies only when the param is absent. Direction stays derived via `defaultSortDir` — no separate direction setting.

**Alternative rejected:** reusing `serverUpdatedAt` as a proxy for date added — it tracks metadata edits, not library insertion, and Plex bumps it on refreshes.

### 7. Release notes are hand-authored post-release

release-please still cuts the version, tag, and CHANGELOG from Conventional Commits, but its raw commit-list release body (the v0.5.0 style) is replaced via `gh release edit` with curated notes in the **v0.6.0 style**: `## What's new in X.Y.Z`, bolded user-facing feature bullets with plain-language descriptions, and a full-changelog compare link. Comparing the two latest releases: v0.5.0's body is unreadable to end users (duplicate commit subjects, "address PR review" noise); v0.6.0's hand-written body is the standard going forward.

## Risks / Trade-offs

- [Watched semantics differ per server: Plex has no atomic "show played" flag] → define show-watched as all leaves watched (`viewedLeafCount >= leafCount`), matching Jellyfin/Emby `Played` semantics; document unknown → unwatched.
- [Existing synced libraries have no watched/date-added data until re-sync] → `watched` defaults to 0, `added_at` is null and sorts last; picker and sort work immediately, data completes on the next sync. Settings/docs note it.
- [Incremental sync skips unchanged items, so their watched flag can go stale] → acceptable for a picker filter; a full sync refreshes. Noted, not solved here.
- [Schema migration on user DBs] → additive `ALTER TABLE ... ADD COLUMN` (both columns, one migration) generated by `bun run db:generate`; no backfill needed, rollback = ignore columns.
- [`ORDER BY random()` scans the table] → fine at library scale (thousands of rows); not a hot path.
- [Fun route reachable while disabled via direct URL] → mitigated by server-side 404 in the load function (decision 2).

## Migration Plan

1. Ship additive migration (`watched` default 0, `added_at` nullable) — applied automatically like prior migrations.
2. Fun is invisible until the user enables `funEnabled`; the date-added sort and default-sort setting are immediately available but default to current behavior. No rollout coordination needed.
3. Rollback: disable the toggle / leave the default sort at `title`; the columns and keys are inert.
4. After the release-please release is published, rewrite its body in the v0.6.0 "What's new" style via `gh release edit`.

## Open Questions

None blocking. If per-episode watched granularity is ever wanted, revisit decision 1.

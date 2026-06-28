## Context

PosterPilot already discovers and displays season posters, season backgrounds, and
episode title cards: `poster_candidates` carries `kind ∈ {poster, background, season,
title_card}` plus `season`/`episode` numbers, and the item page renders them read-only.
But the whole selection→apply→export→revert pipeline is show-level only:
`media_items.selectedPosterUrl` / `selectedBackgroundUrl` hold one pair, `applyToItem`
posts to the show's rating key/item id, `kometa/yaml.ts` emits a single `url_poster` /
`url_background`, and the item page shows one always-expanded wall of providers and sets.

This change makes artwork granular (opt-in per slot) and the layout collapsible. The
constraint is to add granularity without breaking the existing show-level flow, follow the
established `MediaServer` provider abstraction, and keep the work shippable as one minor
release (feat → 0.5.0) behind a branch + PR with the usual quality gates.

## Goals / Non-Goals

**Goals:**
- Independently stage a poster/background per season and a title card per episode.
- One Apply writes every staged slot (show + seasons + episodes) via direct upload and/or
  Kometa export.
- "Use Set" fills all slots a set covers, matched by season/episode number, with per-slot
  override.
- Revert all (show + every applied child) and revert a single season (its poster/background
  and its episode title cards).
- Collapse provider sections, set cards, and season groups; default first-provider /
  first-set expanded; persist open/closed in the browser.
- Preserve current show-level behavior exactly (no breaking change).

**Non-Goals:**
- No new providers or new discovery sources; uses candidates already discovered.
- **Season backgrounds are deferred from the UI**: no provider discovers a per-season
  background image (MediUX/Fanart only yield season *posters* `kind: 'season'` and episode
  *title cards* `kind: 'title_card'`), so there is no candidate to pick. The data model and
  apply/revert/Kometa paths stay generic over `kind: 'background'` season slots, so a season
  background source can drop in later with no rework.
- No per-season *background* in Kometa YAML.
- No bulk (multi-item) granular apply in this change; bulk stays show-level.
- No new media entity tables for seasons/episodes; child IDs are resolved on demand.

## Decisions

### 1. Storage: a dedicated `child_selections` table, show-level columns untouched
Add `child_selections(id, mediaItemId FK, kind ∈ {poster,background,title_card}, season,
episode nullable, url, updatedAt)` with a unique index on
`(mediaItemId, kind, season, episode)`. Show-level poster/background stay on `media_items`.
- *Why:* keeps the existing show-level path and its API/queries unchanged (zero regression
  risk), while child slots get a clean keyed store. Episode title cards use `episode`
  non-null; season slots use `episode = NULL`.
- *Alternative considered:* one unified `selections` table keyed by nullable
  season/episode (null,null = show). Cleaner model but forces migrating live data and
  rewriting the show-level read/write paths — more risk for no user-visible gain.

### 2. Apply reads staged state from the DB (single source of truth)
The Apply action triggers an apply that loads the show selection + all `child_selections`
rows server-side and writes them. The request carries the chosen `method` (and still the
show poster/background for the existing path), but child slots are read from the DB rather
than POSTed as a large array.
- *Why:* matches the existing "stage as you click, then apply" model; avoids resending
  potentially dozens of episode URLs; one authoritative state for both direct and Kometa.

### 3. Child ID resolution on demand at apply time (direct method)
Direct apply lists the show's children through the `MediaServer` provider and matches by
number: season N → its child, episode N under that season → its child. Plex:
`GET /library/metadata/{showKey}/children` (seasons, `index` = number) then
`/library/metadata/{seasonKey}/children` (episodes). Jellyfin/Emby: `/Shows/{id}/Seasons`
and `/Shows/{id}/Episodes` (or `Items?ParentId=`). Upload reuses the same image endpoints
against the child id, then lock.
- *Why:* no schema bloat, no child-ID drift to keep synced. Match-by-number is how MediUX
  sets are themselves keyed.
- *Trade-off:* extra list calls per apply; acceptable for an interactive single-item apply.
  A staged slot whose number has no child on the server is skipped and reported.

### 4. Kometa export: nested `seasons:` / `episodes:`, poster + title card only
Extend the YAML builder so a show entry emits `seasons: { N: { url_poster } }` and
`episodes` title cards under each season, in addition to the show-level
`url_poster`/`url_background`. Season background is omitted (not reliably supported by
Kometa across server types).
- *Why:* Kometa keys season/episode by number, so no IDs are needed and this composes with
  the existing per-item entry. Direct apply still covers season background, so capability
  isn't lost — only the YAML representation is.

### 5. Granular revert via an extended history table
Add nullable `kind` / `season` / `episode` to `applied_posters` (null = show-level). Each
applied child writes a history row. "Revert all" reverses every row for the item; "revert
season N" reverses rows where `season = N` (its poster/background + its episode title
cards). Reversal follows the existing show-level mechanism (unlock the field so the server
reverts; child rating keys/item ids re-resolved by number).
- *Why:* reuses the existing history surface and revert mechanism; per-season scoping is a
  simple filtered query.

### 6. Collapse state in the UI layer, persisted to localStorage
Provider section, set card, and season group each get a collapse toggle. Open/closed is
keyed (e.g. `provider`, `setId`, `season`) and persisted in localStorage so it survives
reloads and item navigation. Default seeding: first provider + its first set expanded,
everything else collapsed. No server/schema involvement.
- *Why:* pure presentation; the kometa page already uses a Svelte `$state` expand pattern
  to follow. The season group's collapse is the same control that scopes per-season revert.

## Risks / Trade-offs

- **Child number ↔ server child mismatch** (specials/season 0, re-ordered episodes, absolute
  numbering) → match strictly by number; skip and report any staged slot with no matching
  child rather than guessing. Surface skipped counts in the apply result.
- **Many episode uploads in one Apply** (title-card-heavy sets) → apply sequentially with
  per-child outcomes; a single child failure doesn't abort the rest and is reported. Bulk
  multi-item granular apply is out of scope to bound the blast radius.
- **Revert fidelity for children** → reuses unlock-based revert; where the server kept no
  prior art, the field returns to the agent default (same behavior as today's show-level
  revert). Documented, not a regression.
- **localStorage growth / stale keys** → keys are small and scoped per provider/set/season;
  acceptable, no eviction needed.
- **Migration** → additive only: new table + nullable columns. Existing rows read back as
  show-level (null kind/season/episode). Rollback = ignore the new table/columns; the
  show-level path is unchanged.

## Migration Plan

1. Add Drizzle schema (`child_selections`, nullable columns on `applied_posters`) and
   generate the migration; additive, no data backfill.
2. Ship server (provider child listing + child apply, service apply/revert reading the new
   state, YAML builder) behind the existing apply/revert routes.
3. Ship UI (season grouping, per-slot selection, collapse).
4. Rollback: revert the release; new table/columns are inert for the old code path.

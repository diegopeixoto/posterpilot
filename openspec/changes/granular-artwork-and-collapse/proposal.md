## Why

PosterPilot discovers season posters, season backgrounds, and episode title cards (they
already appear in the schema and the item page), but selection, apply, export, and revert
all operate only at the show/movie level — so per-season and per-episode artwork can be
seen but never applied. At the same time, a show with several providers and multi-set
MediUX packs renders as one long always-expanded wall, which is hard to scan. This change
makes artwork granular (opt-in per slot) and makes the provider/set/season sections
collapsible.

## What Changes

- **Granular selection**: each season poster and episode title card becomes an
  independently stageable slot, persisted server-side, distinct from the show-level
  poster/background. (Season *backgrounds* are deferred — no provider discovers one — but
  the data/apply model stays generic so a source can drop in later.)
- **Bulk "Use Set"**: staging a set fills every slot it covers — show + each season +
  each episode — matched by season/episode number, with per-slot override.
- **Granular apply**: a single Apply writes all staged slots. Direct apply resolves
  season/episode child IDs from the media server and uploads to each; Kometa export emits
  nested `seasons:` / `episodes:` entries.
- **Granular revert**: "Revert all" reverts the show and every applied child; a per-season
  Revert reverts that season's poster/background and its episode title cards.
- **Collapsible sections**: provider sections, set cards, and season groups can be
  minimized. Default = first provider + its first set expanded, rest collapsed; open/closed
  state persists in the browser (localStorage).
- Kometa season **background** is omitted from YAML (not reliably supported); direct apply
  still sets it on the server.

## Capabilities

### New Capabilities
<!-- none — all changes extend existing capabilities -->

### Modified Capabilities
- `poster-application`: selection, apply, revert, and Kometa YAML export gain
  season/episode granularity (per-slot staging, apply-all, revert-all and
  revert-per-season, nested `seasons:`/`episodes:` YAML).
- `media-server`: new ability to list a show's season/episode children and to set
  poster/background/title-card images on those child items (Plex child rating keys;
  Jellyfin/Emby child item ids).
- `web-ui`: item page renders per-season groups with independently selectable slots and
  collapsible provider/set/season sections with persisted state.

## Impact

- **Schema**: new `child_selections` table; `applied_posters` gains nullable
  `kind` / `season` / `episode` columns (null = show-level). Drizzle migration required.
- **Server**: `posters/service.ts` (apply/revert), `media-server/*` (Plex + Emby/Jellyfin
  clients, interface), `kometa/yaml.ts`, item select/apply/revert API routes, `queries.ts`.
- **UI**: `routes/item/[id]/+page.svelte` (selection model, season grouping, collapse).
- **i18n**: new keys across all 5 catalogs (`en`, `es`, `zh`, `ja`, `pt-BR`).
- **No breaking changes**: show-level selection/apply/revert behavior is preserved.

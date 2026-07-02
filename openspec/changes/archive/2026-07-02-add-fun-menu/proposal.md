# Add "Fun" menu with random movie/series picker + date-added library sort

## Why

PosterPilot already holds a synced, metadata-rich copy of the user's library (type, genres, year, posters). Beyond managing artwork, that data can power lightweight "what should we watch tonight?" utilities. A hidden-by-default **Fun** section gives these experiments a home without cluttering the core poster-management workflow. Alongside it, the library grid gains the most-requested missing sort — **date added on the server** — with a configurable default sort, since both ride the same sync plumbing this change already opens up.

## What Changes

- New **Fun** area in the app, gated behind a new `funEnabled` setting (default **off**). When disabled, no nav entry and the `/fun` route is not reachable.
- New boolean toggle in Settings to enable/disable the Fun menu (persisted like other settings, overridable via `FUN_ENABLED` env var).
- First Fun tool: a **random movie/series decider** that picks one item at random from the synced library, with filters:
  - media type: movie, show, or both;
  - genre (from the library's existing genre list) or all;
  - year range (min/max) or all;
  - include or exclude **watched** items.
- Library sync starts capturing **watched status** from the media server (Plex `viewCount`, Jellyfin/Emby `UserData.Played`) into the local `media_items` table — required by the watched filter. Items with unknown watched status are treated as unwatched.
- Library sync also captures the server's **date added** (Plex `addedAt`, Jellyfin/Emby `DateCreated`) per item; the library grid gains a "Date added" sort option.
- New `libraryDefaultSort` setting (default `title`, `LIBRARY_DEFAULT_SORT` env override) controls which sort the library grid opens with when the URL specifies none.
- New i18n keys (`nav_fun`, `fun_*`, settings labels, `library_sort_added`) across all 5 locales (en/es/zh/ja/pt-BR).
- After merge and the release-please release, the release notes are hand-written in the curated v0.6.0 "What's new" style (user-facing feature bullets), replacing the raw commit-list body.

## Capabilities

### New Capabilities

- `fun-random-picker`: the Fun section (gated navigation destination) and the random movie/series decider — filter controls, random selection over the synced library, and result presentation with poster/metadata.

### Modified Capabilities

- `configuration`: add `funEnabled` boolean setting (default false, UI-writable, `FUN_ENABLED` env override) and `libraryDefaultSort` setting (default `title`, `LIBRARY_DEFAULT_SORT` env override), both exposed via public config.
- `web-ui`: conditional "Fun" navigation entry gated on the setting; new Fun toggle and default-sort select in the Settings view; library grid sortable by date added and opening with the configured default sort.
- `media-server`: provider item listings expose a watched/played flag (Plex `viewCount > 0`, Jellyfin/Emby `UserData.Played`) and a date-added timestamp (Plex `addedAt`, Jellyfin/Emby `DateCreated`) per item, persisted by library sync.

## Impact

- **Config layer**: `src/lib/server/config/index.ts` (AppConfig, ENV_MAP, DEFAULTS, WRITABLE_KEYS, resolveConfig, PublicConfig/publicConfig) — two new settings.
- **DB schema**: new `watched` and `added_at` columns on `media_items` (`src/lib/server/db/schema.ts`) + one migration; sync writes both.
- **Media-server providers**: `ServerItem` type + Plex/Jellyfin/Emby providers (`src/lib/server/media-server/*`) fetch watched state and date added.
- **Queries**: new random-pick query plus `added` sort in `LibrarySort`/`orderFor` in `src/lib/server/queries.ts` (reuses `json_each` genre filter and `random()` ordering patterns).
- **Routes/UI**: new `src/routes/fun/` page; nav in `src/routes/+layout.svelte` + `+layout.server.ts`; toggle + default-sort select in `src/routes/settings/+page.svelte`; sort option + config-driven default in `src/routes/library/`.
- **Release notes**: post-release, the GitHub release body for this version is rewritten by hand in the v0.6.0 style.
- **i18n**: all 5 catalogs in `messages/*.json`.
- No breaking changes; feature fully opt-in.

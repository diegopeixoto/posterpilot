## Context

PosterPilot already syncs a Plex library, resolves each item to a TMDB id, scrapes MediUX artwork candidates, and applies covers via Plex and/or Kometa. The UI is intentionally thin: the item page is a poster plus flat candidate grids, and the library filters on a few booleans. The resolver (`src/lib/server/tmdb/client.ts`) already fetches the TMDB `/{movie|tv}/{id}` detail document during sync to classify media type, but reads only the `id` from it. The MediUX parser (`src/lib/server/mediux/parser.ts`) already groups files by `set_id`. Apply already accepts a `backgroundUrl` and the schema already has `selectedBackgroundUrl`. These existing seams make a MediUX-style redesign mostly additive rather than a rewrite.

Stack constraints: SvelteKit + Svelte 5 runes, Tailwind v4, SQLite via Drizzle (libsql), in-process job queue with SSE. Self-hosted single-container scale (one user, libraries up to low tens of thousands of items).

## Goals / Non-Goals

**Goals:**

- A metadata-rich, image-forward item page (backdrop hero, clearlogo/title, rating · year · runtime or seasons · episodes, genres, overview) for movies and shows.
- Candidates presented as MediUX-style sets with uploader attribution; a sticky custom-set builder that stages a poster + background from any source (candidate / URL / upload).
- Library browsing by rating, genre, and sort order, with a spotlight backdrop hero.
- One consistent MediUX visual language (violet accent, near-black, glassy header) across every page.
- Reuse existing endpoints/columns wherever they already cover the behavior.

**Non-Goals:**

- No change to the apply pipeline (Plex upload, Kometa YAML), job queue, or SSE.
- No normalized metadata/genre tables — denormalized columns are sufficient at this scale.
- No new authentication, multi-user, or remote-image proxy/caching layer.
- No editing/uploading artwork back to MediUX.

## Decisions

**1. Enrich metadata during sync, reusing the resolve call.**
The sync per-item task already triggers `resolveTmdb`, which fetches the TMDB detail JSON. We extend that path to read `overview`, `tagline`, `genres`, `runtime`, `vote_average`, `backdrop_path`, `number_of_seasons/episodes`, and `credits.cast` (via `append_to_response=credits`) from the same (cached) response, then persist them. Only the clearlogo needs a separate `/{type}/{id}/images` call.
_Alternatives:_ enrich at discover-time (rejected — library-wide rating/genre filters would only cover discovered items) or a separate backfill job (rejected as the default — extra step to remember; we still expose forced-refresh re-enrichment).

**2. Denormalized metadata columns; genres and cast as JSON text.**
Add columns to `media_items`: `overview`, `tagline`, `genres` (JSON array of names), `runtime`, `rating` (real), `backdrop_url`, `logo_url`, `season_count`, `episode_count`, `cast` (JSON array of `{name, character, profileUrl}`, top ~8). Genre filtering uses SQLite `json_each` (or `LIKE` on the JSON) — adequate for self-hosted scale.
_Alternatives:_ a `media_metadata` side table or a `genres`/`item_genres` join (rejected — over-engineered here; one row per item is simplest and fastest to query).

**3. Clearlogo from TMDB images, English-preferred.**
The hero logo comes from TMDB `/images` (`logos[]`, prefer `iso_639_1 === 'en'`, else first). MediUX sets also carry `logo` files, but TMDB is the consistent, always-available source and decouples the hero from whether covers were discovered.
_Alternative:_ parse MediUX logo files (rejected for the hero — only present once covers are scraped; kept as a possible future per-set extra).

**4. The "custom set" is the existing selection, made visible.**
`selectedPosterUrl` + `selectedBackgroundUrl` already model a staged poster+background. The sticky builder is a persistent view of those two values: clicking a candidate sets the matching field (existing `/select` endpoint, extended to background), a URL fills a field, an upload uses the existing `/upload` endpoint (Plex-only). "Use this set" sets both fields from one set. Apply uses the existing `/apply` endpoint with both URLs. No new persistence model.
_Alternative:_ a dedicated `custom_sets` table (rejected — YAGNI; the two columns already are the staging area).

**5. Set author parsed defensively from the RSC payload.**
Extend `parseListingSets` to capture an author/username near each `set_id` marker in the decoded Next.js payload, stored as `poster_candidates.set_author` (nullable). Parsing is best-effort: a missing/changed shape yields `null`, never a failure.

**6. Centralized theme, applied via the shell.**
Define the MediUX palette (violet accent on near-black) as Tailwind v4 theme tokens / CSS variables in `app.css`, and apply the shell (header, cards) in `+layout.svelte`. Dashboard, Jobs, and Settings are re-laid-out to the same card/typography system. The current mixed indigo/violet usages are replaced with the single accent.

**7. Shows reuse the same set machinery.**
Show candidates already include `season` and `title_card` kinds. The item page renders three set regions for shows — main (poster+backdrop), season posters, and title cards — driven by candidate `kind`. TV metadata (season/episode counts) replaces runtime in the hero line.

## Risks / Trade-offs

- **Extra TMDB `/images` call per item during sync** → Cached via the shared HTTP cache; only fetched when `logo_url` is missing or on forced refresh. One call per item, bounded by existing sync concurrency.
- **MediUX author parsing is brittle** (undocumented RSC shape) → Best-effort with `null` fallback; set cards render without an author when absent. No behavior depends on it.
- **Items synced before this change lack metadata** → They render with graceful fallbacks (title instead of logo, no chips); a re-sync or per-item forced refresh backfills them. Surface this as a one-line "re-sync to enrich" hint when metadata is absent.
- **Genre filter on JSON column** → `json_each` scan is fine at self-hosted scale; revisit only if libraries grow far beyond expectations.
- **Larger, image-heavy pages** → Use lazy-loading for candidate images (already in place) and load backdrops/logos at sensible sizes.

## Migration Plan

1. Add the new columns via a Drizzle migration (`bun run db:generate`); all new columns are nullable so the migration is non-destructive and auto-applies on startup.
2. Ship the enrichment in the sync task; existing items backfill on their next sync or via forced refresh.
3. Ship UI behind no flag — old items degrade gracefully, so no phased rollout is needed.
4. Rollback: revert the code; the added nullable columns are inert and can be left in place or dropped in a follow-up migration.

## Open Questions

- Cast depth and whether to show character names in the hero vs a separate row — default to top ~8 with names, refine during implementation.
- Exact spotlight selection rule (most-recently-applied with a backdrop) — confirm against real data during build.

## Why

PosterPilot sources artwork from a single place — mediux.pro — via a MediUX-specific scraper and parser. Self-hosters routinely combine multiple artwork sources (Fanart.tv, ThePosterDB, TMDB, TheTVDB) to find the best cover for a title. Today adding any source would mean bolting more provider-specific code onto the candidate pipeline. Introducing a provider abstraction lets the app discover candidates from several sources behind one interface, present them together grouped by provider, and let users enable the sources they want — without special-casing each one across the codebase.

## What Changes

- **Add a `PosterProvider` abstraction** — a single interface for "given a resolved title, return artwork candidate sets". The existing MediUX scraper becomes one provider behind it; discovery fans out across all enabled providers and merges results.
- **Add new providers:**
  - **Fanart.tv** (API, keyed) — posters, backgrounds, clearlogos, season art for movies and TV.
  - **TMDB artwork** (API, existing TMDB key) — posters and backdrops from the TMDB images endpoint, surfaced as selectable candidates (near-free; the key is already configured).
  - **ThePosterDB** (scrape, no key) — community poster sets, the same listing-payload approach used for MediUX.
- **Tag candidates with their provider** — `poster_candidates` gains a `provider` column; the item page groups candidates by provider, then by set within each provider.
- **Per-provider configuration** — enable/disable each provider and supply keys (Fanart.tv) in Settings and via environment variables. MediUX and TMDB-artwork need no key; ThePosterDB needs none.
- **Resilient discovery** — a provider that fails or is disabled is skipped; the others still return candidates.

## Capabilities

### New Capabilities
- `poster-providers`: A provider abstraction and registry that discovers artwork candidates from multiple enabled sources (MediUX, Fanart.tv, TMDB artwork, ThePosterDB), tags each candidate with its provider, and degrades gracefully when a provider fails.

### Modified Capabilities
- `mediux-scraping`: The MediUX scraper/parser is refactored to implement the `PosterProvider` interface as one provider among several, rather than the sole candidate source.
- `configuration`: Adds per-provider enable flags and the Fanart.tv API key (with environment-variable equivalents).
- `web-ui`: The item page groups candidates by provider (and set within a provider); Settings exposes provider toggles and the Fanart.tv key.
- `poster-application`: Candidate selection and auto-selection operate across providers (candidates remain plain image URLs, so apply itself is unchanged).

## Impact

- **Schema:** `poster_candidates` gains a `provider` column. New Drizzle migration.
- **Code:** new `posters/providers/` (interface + registry + mediux/fanarttv/tmdb/theposterdb providers); `discoverForItem` fans out across enabled providers; `configuration` + Settings UI for provider toggles/keys; item-page grouping by provider.
- **External calls:** Fanart.tv (`webservice.fanart.tv`) and TMDB images per item, both cached; ThePosterDB listing pages (scraped, throttled like MediUX).
- **No breaking changes** to apply (Plex/Kometa) or the job/SSE pipeline. Existing MediUX candidates keep working; `provider` defaults to `mediux` for pre-existing rows.

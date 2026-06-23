## Context

Candidate discovery is currently MediUX-only: `discoverForItem` (in `posters/service.ts`) calls `discoverCandidates` → the MediUX scraper/parser, and stores `poster_candidates` rows grouped by `setId`. The item page renders those candidates grouped into sets. TMDB images are already fetched for the hero (backdrop/logo) via `tmdb/client.ts`, so a TMDB-artwork provider largely reuses existing plumbing. This change introduces a provider abstraction so MediUX becomes one of several sources.

## Goals / Non-Goals

**Goals:**
- One `PosterProvider` interface; MediUX, Fanart.tv, TMDB artwork, and ThePosterDB behind it.
- Fan-out discovery that merges candidates and tags each with its provider; per-provider enable/keys; failures isolated.
- Item page groups candidates by provider then set; Settings exposes provider toggles + the Fanart.tv key.

**Non-Goals:**
- No change to apply (Plex/Kometa) — candidates remain plain image URLs.
- No TheTVDB or RPDB provider in this change (the interface makes them easy follow-ons).
- No re-ranking/scoring of candidates beyond a deterministic provider order for auto-select.

## Decisions

**1. Provider interface + registry.**
```
interface PosterProvider {
  id: 'mediux' | 'fanarttv' | 'tmdb' | 'theposterdb';
  requiresKey: boolean;
  isAvailable(config): boolean;          // enabled && key present if required
  discover(item, config, opts): Promise<ProviderSet[]>;  // sets of candidates
}
```
A registry holds all providers; `discoverForItem` iterates the available ones, runs each inside its own try/catch, and merges results. *Alternative:* keep MediUX special-cased and add `if (fanart) …` branches — rejected (the branching this change exists to remove).

**2. Tag candidates with `provider`; reuse the candidate/set model.**
Add `poster_candidates.provider` (text, default `'mediux'` for existing rows). Grouping becomes provider → set: extend the existing `groupCandidatesBySet` into a `groupByProvider` that returns `[{ provider, sets: CandidateSet[] }]`. The `hasMediux` flag is repurposed to mean "has any provider artwork" (kept under its current column name to avoid churn; documented).

**3. Fanart.tv keying.**
Fanart.tv keys movies by TMDB/IMDb (`/v3/movies/{tmdbId}`) but TV by **TVDB** id (`/v3/tv/{tvdbId}`). We already store `tvdbId`; the Fanart.tv TV path is skipped when no `tvdbId` is present. Map Fanart.tv types → candidate kinds (movieposter/tvposter → poster, moviebackground/showbackground → background, hdmovielogo/hdtvlogo → logo (hero-only, not a cover candidate), seasonposter → season). *Alternative:* resolve TVDB from TMDB on the fly — deferred; we already have the id from Plex GUIDs.

**4. TMDB artwork provider reuses the images call.**
Returns `posters[]` and `backdrops[]` from the TMDB images endpoint as one synthetic "set" per kind. Reuses `tmdbAuth` + the shared HTTP cache; no new credential.

**5. ThePosterDB is scrape-based, opt-in, disabled by default.**
Same listing-payload approach as MediUX, with the same throttle/retry/cache. Disabled by default given scraping fragility and ToS sensitivity; the user opts in. Failures are isolated like any provider.

**6. Deterministic auto-select order.**
Provider preference for auto-select: MediUX → Fanart.tv → ThePosterDB → TMDB (first provider with a poster wins). Hard-coded order now; a configurable order is a future enhancement.

## Risks / Trade-offs

- **ThePosterDB scraping is brittle / ToS-sensitive** → opt-in, disabled by default, isolated failures, throttled + cached. Document clearly.
- **More providers → more network per discovery** → each provider call is cached (TMDB/Fanart.tv 30-day TTL) and runs within the existing MediUX throttle/concurrency; disabled providers cost nothing.
- **Fanart.tv TV needs a TVDB id** → skipped gracefully when absent; surfaced as "no Fanart.tv TV match" rather than an error.
- **`hasMediux` semantic drift** → renaming the column is avoided to skip a migration; the meaning ("has any artwork") is documented and the UI label generalised.

## Migration Plan

1. Add the nullable `provider` column (default `'mediux'`) via a Drizzle migration; existing rows read as MediUX.
2. Ship the registry with MediUX wired first (behaviour-preserving), then add the other providers.
3. New providers are disabled by default except MediUX and TMDB artwork (no key, low risk); the user enables Fanart.tv (with a key) and ThePosterDB in Settings.
4. Rollback: disable the new providers; the MediUX path is unchanged. The nullable column is inert if unused.

## Open Questions

- Whether to surface Fanart.tv clearlogos as an alternative hero logo source (currently TMDB-only) — likely yes as a follow-on, out of scope here.
- Default provider order and whether to make it user-configurable — fixed order for now.

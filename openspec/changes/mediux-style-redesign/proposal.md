## Why

The current UI is functional but plain: the item page is a poster plus a flat candidate grid, with no movie context (no backdrop, logo, overview, rating, or genres), and the library can only be filtered by a few flags. MediUX (mediux.pro) sets the bar for an image-forward artwork-browsing experience — rich hero banners, artwork grouped into uploader "sets", and metadata-driven browsing. Mirroring that design makes PosterPilot far more pleasant to browse and pick covers in, and the metadata it requires also unlocks rating/genre sorting and filtering the user asked for.

## What Changes

- **Fetch display metadata from TMDB during sync** — backdrop, clearlogo, overview, tagline, genres, runtime, rating (vote average), top cast, and (for shows) season/episode counts — persisted per item. Most fields piggyback on the TMDB detail call the resolver already makes; the logo needs one extra `/images` call per item.
- **MediUX-style item page** — full-bleed backdrop hero with the clearlogo (falling back to the title), rating · year · runtime (movies) / seasons · episodes (shows), genre chips, and overview; existing Find/Apply actions move into the hero.
- **Artwork shown as sets** — candidates are grouped into set cards showing the uploader's name with poster and backdrop side by side; "Use this set" stages both at once, or a single image can be taken on its own. Shows additionally surface season-poster sets and title-card sets.
- **Custom set builder** — a sticky bottom bar with a poster slot and a backdrop slot, auto-routed by kind, fillable from any candidate, a pasted URL, or an uploaded file; one Apply ships the pair. (Upload = Plex-only; URL = Plex + Kometa.)
- **Rich library** — a spotlight backdrop hero (most recently changed) above the poster wall; a filter/sort bar adding sort (rating / title / year / recently-changed / runtime), a minimum-rating filter, and genre filtering on top of the existing type / has-MediUX / missing / unchanged toggles; tiles show a rating badge and status badge with hover title/year.
- **Shows are first-class** — item page renders TV metadata and the season-poster / title-card sets.
- **Reskin every page** — Dashboard, Jobs, and Settings adopt the unified MediUX visual language (violet accent on near-black, glassy sticky header, consistent cards).

## Capabilities

### New Capabilities

- `tmdb-metadata`: Fetch and persist per-item display metadata from TMDB (backdrop, clearlogo, overview, tagline, genres, runtime, rating, cast, season/episode counts) during library sync, with caching and forced-refresh support.

### Modified Capabilities

- `web-ui`: Item detail becomes a metadata-rich hero with artwork grouped into sets and a custom set builder; the library gains a spotlight hero plus rating/genre/sort filtering; shows are rendered with TV metadata and season/title-card sets; all pages adopt the MediUX visual language.
- `mediux-scraping`: Extracted candidates are grouped into sets that carry the uploader's attribution (set author) parsed from the embedded page payload.
- `poster-application`: A user can stage a poster and a background together as a set, and can supply a custom cover by URL (Plex + Kometa) or uploaded file (Plex only).

## Impact

- **Schema:** `media_items` gains metadata columns (overview, tagline, genres, runtime, rating, backdrop_url, logo_url, season_count, episode_count, cast); `poster_candidates` gains `set_author`. New Drizzle migration.
- **Code:** new TMDB metadata client + sync task enrichment; `mediux/parser.ts` set-author extraction; `queries.ts` library filter/sort/genre; item, library, dashboard, jobs, settings Svelte pages; layout shell theming; custom-set apply wiring (URL + upload already partially present).
- **External calls:** one extra TMDB `/images` request per item during sync (cached).
- **No breaking changes** to apply methods, Kometa export, or the job/SSE pipeline.

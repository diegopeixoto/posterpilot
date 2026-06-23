## 1. Project scaffold

- [x] 1.1 Initialize a SvelteKit + TypeScript project on Bun (adapter-node, run under Bun)
- [ ] 1.2 Add Tailwind CSS and a Svelte component library (bits-ui / shadcn-svelte) with a dark, image-forward base theme
- [ ] 1.3 Configure linting/formatting and add `fallow` (`npx fallow health` / `dead-code`) as a dev/CI check
- [ ] 1.4 Set up project structure: `src/lib/server/{plex,tmdb,mediux,posters,jobs,db,config}` and route folders
- [x] 1.5 Add a `.env.example` documenting `PLEX_URL`, `PLEX_TOKEN`, `TMDB_KEY`, `KOMETA_ASSETS_DIR`, `DATABASE_URL`, `PORT`, scraping knobs

## 2. Persistence (SQLite + Drizzle)

- [x] 2.1 Define Drizzle schema: `media_items`, `poster_candidates`, `applied_posters`, `jobs`, `http_cache`, `settings`
- [x] 2.2 Wire the libsql driver and Drizzle, with the DB file under the configured data dir
- [x] 2.3 Generate and apply initial migrations; create the DB on first run (migrations run on startup via hooks.server.ts)

## 3. Configuration

- [x] 3.1 Implement config loading: environment variables overriding persisted settings (env wins)
- [x] 3.2 Implement settings persistence (read/write the `settings` table) with secret redaction (never return stored secrets to the client; "set/not set" only)
- [x] 3.3 Implement required-config validation and clear missing-config errors for sync/resolve operations

## 4. Plex integration

- [ ] 4.1 Implement a thin Plex client: connection test (server identity), token auth
- [ ] 4.2 List movie/show sections; list section items with rating key, title, year, type, GUIDs, current poster URL
- [ ] 4.3 Implement `uploadPosterFromUrl(ratingKey, url)` with poster-field locking and error reporting
- [ ] 4.4 Cover the client with tests against recorded Plex responses

## 5. TMDB resolution

- [ ] 5.1 Implement TMDB client with credential auto-detection (JWT bearer vs. v3 api_key)
- [ ] 5.2 Resolve GUIDs to TMDB ID + media type (prefer tmdb, then imdb, then tvdb; `find` for external IDs; movie/show classification)
- [ ] 5.3 Cache resolutions in SQLite with a forced-refresh path
- [ ] 5.4 Tests for resolution precedence, classification, and cache hit/refresh

## 6. MediaUX scraping

- [ ] 6.1 Implement page fetch for a TMDB ID (movie/show path) and set-link extraction, newest-first
- [ ] 6.2 Implement set loading + embedded-payload parsing into candidates (poster/background/season/title-card) isolated in one parser with skip-and-continue on parse failure
- [ ] 6.3 Add bounded concurrency (`p-limit`-style), retry-with-backoff, per-request delay, and SQLite HTTP caching with TTL + forced refresh
- [ ] 6.4 Fixture-based tests for the parser (including a "structure changed" fixture that must degrade gracefully)

## 7. Poster application

- [ ] 7.1 Implement candidate selection: manual selection and automatic "newest set primary poster" selection
- [ ] 7.2 Implement direct apply (delegate to Plex `uploadPosterFromUrl`) recording method "plex"
- [ ] 7.3 Implement Kometa YAML export (`url_poster`/`url_background`) to the mounted assets dir, updating existing entries in place, recording method "kometa"
- [ ] 7.4 Implement combined apply (both methods) recording each outcome independently
- [ ] 7.5 Record applied posters in history; tests for each method and partial-failure visibility

## 8. Background jobs

- [ ] 8.1 Implement an in-process job queue + async worker with bounded concurrency
- [ ] 8.2 Implement job types: library sync, bulk discovery, bulk apply
- [ ] 8.3 Implement SSE progress streaming (processed/total, current item, status), including snapshot-on-subscribe for in-progress jobs
- [ ] 8.4 Implement job cancellation and persist job history; mark interrupted jobs failed on startup
- [ ] 8.5 Tests for progress reporting, cancellation, and restart handling

## 9. Web UI

- [ ] 9.1 Dashboard route: stats, last sync, active jobs
- [ ] 9.2 Library grid: poster grid with type/missing-poster/has-mediux filters and title search; empty state
- [ ] 9.3 Item detail: current vs. candidate comparison, preview, select, apply with method toggle; "find covers" action when none discovered
- [ ] 9.4 Bulk actions: multi-select + bulk discover/apply launching a background job
- [ ] 9.5 Jobs view: active + past jobs with live SSE progress
- [ ] 9.6 Settings view: enter/test Plex + TMDB, Kometa dir, default apply method; inline validation

## 10. Packaging & deployment

- [ ] 10.1 Write a single Dockerfile (Bun base) building UI + API + worker into one image
- [ ] 10.2 Write a documented `docker-compose.yml` for Unraid: data volume, Kometa assets volume, published port, required env
- [ ] 10.3 Verify the same image runs on Mac and Unraid with persistent data and exports landing in the mounted Kometa dir
- [ ] 10.4 Write README: setup, env vars, running on Mac vs. Unraid, and how Kometa consumes the exports

## 11. Verification

- [ ] 11.1 End-to-end check: configure → sync a Plex section → discover covers → apply (direct) → confirm in Plex
- [ ] 11.2 End-to-end check: apply (Kometa export) → confirm YAML lands in the mounted dir in a Kometa-consumable shape
- [ ] 11.3 Run `fallow health`/`dead-code` and resolve findings; ensure tests pass in CI

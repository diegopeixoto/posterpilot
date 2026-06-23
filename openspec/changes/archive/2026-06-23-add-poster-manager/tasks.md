## 1. Project scaffold

- [x] 1.1 Initialize a SvelteKit + TypeScript project on Bun (adapter-node, run under Bun)
- [x] 1.2 Add Tailwind CSS v4 with a dark, image-forward base theme (custom Svelte components instead of an external component library)
- [x] 1.3 Configure linting/formatting (prettier) and add `fallow` (`bun run fallow`) as a dev/CI check
- [x] 1.4 Set up project structure: `src/lib/server/{plex,tmdb,mediux,posters,jobs,db,config,http,kometa}`, `src/lib/components`, and route folders
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

- [x] 4.1 Implement a thin Plex client: connection test (server identity), token auth
- [x] 4.2 List movie/show sections; list section items with rating key, title, year, type, GUIDs, current poster URL
- [x] 4.3 Implement `uploadPosterFromUrl(ratingKey, url)` with poster-field locking and error reporting
- [x] 4.4 Cover the client with tests against recorded Plex responses

## 5. TMDB resolution

- [x] 5.1 Implement TMDB client with credential auto-detection (JWT bearer vs. v3 api_key)
- [x] 5.2 Resolve GUIDs to TMDB ID + media type (prefer tmdb, then imdb, then tvdb; `find` for external IDs; movie/show classification)
- [x] 5.3 Cache resolutions in SQLite with a forced-refresh path
- [x] 5.4 Tests for resolution precedence, classification, and cache hit/refresh

## 6. MediaUX scraping

- [x] 6.1 Implement page fetch for a TMDB ID (movie/show path) and set-link extraction, newest-first
- [x] 6.2 Implement set loading + embedded-payload parsing into candidates (poster/background/season/title-card) isolated in one parser with skip-and-continue on parse failure
- [x] 6.3 Add bounded concurrency (`p-limit`-style), retry-with-backoff, per-request delay, and SQLite HTTP caching with TTL + forced refresh
- [x] 6.4 Fixture-based tests for the parser (including a "structure changed" fixture that must degrade gracefully)

## 7. Poster application

- [x] 7.1 Implement candidate selection: manual selection and automatic "newest set primary poster" selection
- [x] 7.2 Implement direct apply (delegate to Plex `uploadPosterFromUrl`) recording method "plex"
- [x] 7.3 Implement Kometa YAML export (`url_poster`/`url_background`) to the mounted assets dir, updating existing entries in place, recording method "kometa"
- [x] 7.4 Implement combined apply (both methods) recording each outcome independently
- [x] 7.5 Record applied posters in history; tests for each method and partial-failure visibility (service.test.ts: plex/kometa/both/partial-failure/missing-config)

## 8. Background jobs

- [x] 8.1 Implement an in-process job queue + async worker with bounded concurrency
- [x] 8.2 Implement job types: library sync, bulk discovery, bulk apply
- [x] 8.3 Implement SSE progress streaming (processed/total, current item, status), including snapshot-on-subscribe for in-progress jobs
- [x] 8.4 Implement job cancellation and persist job history; mark interrupted jobs failed on startup
- [x] 8.5 Tests for progress reporting, cancellation, and restart handling (events.test.ts bus; runner.test.ts against an in-memory libsql DB: completion, failure, cancel mid-run, mark-interrupted)

## 9. Web UI

- [x] 9.1 Dashboard route: stats, last sync, active jobs
- [x] 9.2 Library grid: poster grid with type/missing-poster/has-mediux filters and title search; empty state
- [x] 9.3 Item detail: current vs. candidate comparison, preview, select, apply with method toggle; "find covers" action when none discovered
- [x] 9.4 Bulk actions: multi-select + bulk discover/apply launching a background job
- [x] 9.5 Jobs view: active + past jobs with live SSE progress
- [x] 9.6 Settings view: enter/test Plex + TMDB, Kometa dir, default apply method; inline validation

## 10. Packaging & deployment

- [x] 10.1 Write a single Dockerfile (Bun base) building UI + API + worker into one image (builds clean, exit 0)
- [x] 10.2 Write a documented `docker-compose.yml` for Unraid: data volume, Kometa assets volume, published port, required env
- [x] 10.3 Verified end to end: `docker compose up -d --build` runs the container, which serves 200 on all routes (`/`, `/library`, `/jobs`, `/settings`, `/api/settings/test`) with 0 errors in logs. Same image for Unraid; Kometa export to a mounted dir verified separately.
- [x] 10.4 Write README: setup, env vars, running on Mac vs. Unraid, and how Kometa consumes the exports

## 11. Verification

- [x] 11.1 End-to-end check: configure → sync → discover covers → apply (Plex + Kometa) → confirmed in Plex (2 Fast 2 Furious, both applied_posters rows success, new poster visible in Plex)
- [x] 11.2 End-to-end check: apply (Kometa export) → confirm YAML lands in the mounted dir in a Kometa-consumable shape
- [x] 11.3 Run `fallow health` (maintainability 92/good) and trim a redundant re-export; tests pass (44)

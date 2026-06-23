## 1. Schema & migration

- [x] 1.1 Add metadata columns to `media_items` in `db/schema.ts`: `overview`, `tagline`, `genres` (json text), `runtime`, `rating` (real), `backdropUrl`, `logoUrl`, `seasonCount`, `episodeCount`, `cast` (json text) — all nullable
- [x] 1.2 Add `setAuthor` (nullable text) to `poster_candidates` in `db/schema.ts`
- [x] 1.3 Run `bun run db:generate` and commit the generated migration; confirm it auto-applies on startup
- [x] 1.4 Update `MediaItem` / `PosterCandidate` types and any insert sites that build these rows

## 2. TMDB metadata (capability: tmdb-metadata)

- [x] 2.1 Add a metadata fetch in `tmdb/client.ts` that reads overview, tagline, genres, runtime, rating, backdrop_path, season/episode counts, and `credits.cast` from the detail response (use `append_to_response=credits`)
- [x] 2.2 Add a clearlogo fetch via `/{type}/{id}/images`, preferring an English logo, returning an absolute image URL (build TMDB image base URLs)
- [x] 2.3 Reuse the shared HTTP cache + forced-refresh flag for both calls; only fetch the logo when missing or on forced refresh
- [x] 2.4 Unit-test metadata parsing (present fields, missing optional fields, show vs movie, logo language preference, no-logo fallback)

## 3. Sync enrichment (capabilities: tmdb-metadata, mediux-scraping)

- [x] 3.1 Extend the sync per-item task (`jobs/tasks.ts`) to persist the fetched metadata after resolution
- [x] 3.2 Extend `mediux/parser.ts` `parseListingSets` to capture a best-effort set author near each `set_id` marker; expose it on the set / candidates (null when absent)
- [x] 3.3 Persist `setAuthor` when writing `poster_candidates` during discovery
- [x] 3.4 Unit-test set-author extraction (author present, absent, malformed payload)

## 4. Library queries (capability: web-ui)

- [x] 4.1 Extend `LibraryFilter` + `listLibrary` in `queries.ts` with minimum-rating and genre filters and sort options (title, year, rating, runtime, recently-changed)
- [x] 4.2 Add a "recently changed" sort/join against `applied_posters` and a query for the spotlight item (most recently applied with a backdrop)
- [x] 4.3 Add a distinct-genres query to populate the genre filter chips
- [x] 4.4 Update `getItemDetail` to return candidates grouped by set (with author) and the item's metadata

## 5. Theme & app shell (capability: web-ui)

- [x] 5.1 Define MediUX palette as Tailwind v4 theme tokens / CSS vars in `app.css` (violet accent, near-black surfaces)
- [x] 5.2 Reskin `+layout.svelte` shell: glassy sticky header, nav with active state + job badge, single accent; remove indigo/violet mix
- [x] 5.3 Add shared building blocks (badge, chip, stat card, section heading) used across pages

## 6. Item page — hero & metadata (capability: web-ui)

- [x] 6.1 Build the backdrop hero: backdrop bg with scrims, clearlogo with title fallback, rating · year · runtime (movies) / seasons · episodes (shows), genre chips, overview
- [x] 6.2 Move Find covers / Apply (method picker) / Revert actions into the hero; keep current-poster reference
- [x] 6.3 Graceful fallbacks when metadata is absent (title text, no chips, "re-sync to enrich" hint)

## 7. Item page — sets & custom builder (capabilities: web-ui, poster-application)

- [x] 7.1 Render candidates as set cards: per-set poster + backdrop side by side, uploader attribution, "Use this set" stages both
- [x] 7.2 Single-image pick stages just that piece into the matching slot
- [x] 7.3 For shows, render season-poster sets and title-card sets in addition to the main sets
- [x] 7.4 Build the sticky bottom-bar custom-set builder: poster slot + background slot, auto-route by kind, fill from URL or upload, Apply ▾ method picker
- [x] 7.5 Wire builder to existing endpoints: extend `/select` to accept background; reuse `/upload` (Plex-only) and `/apply` (poster + background); surface the upload→Kometa limitation
- [ ] 7.6 Component-test the builder slot/apply logic where practical (deferred — no Svelte component-test harness in repo; verified via type-check + manual pass)

## 8. Library page (capability: web-ui)

- [x] 8.1 Reskin the poster wall: tiles with rating badge, status badge, hover title/year, hover bulk checkbox
- [x] 8.2 Build the filter/sort bar: search, type, sort, rating≥, genre chips, has-MediUX / missing / unchanged toggles wired to the query params
- [x] 8.3 Add the spotlight backdrop hero above the wall (recently-changed item)

## 9. Dashboard, Jobs, Settings (capability: web-ui)

- [x] 9.1 Reskin Dashboard stat cards + recent-jobs table to the new system
- [x] 9.2 Reskin Jobs list/progress to the new system
- [x] 9.3 Reskin Settings forms to the new system

## 10. Verification

- [x] 10.1 `bun run check`, `bun run test`, `bun run format` clean (75 tests pass, 0 type errors; `bun run build` also succeeds)
- [x] 10.2 `openspec validate mediux-style-redesign` passes
- [ ] 10.3 Manual pass: sync enriches metadata; item hero (movie + show); set cards + builder apply; library sort/filter/spotlight; all pages themed (requires live Plex + TMDB — run by maintainer)

# Tasks — add-fun-menu

## 1. Configuration

- [x] 1.1 Add `funEnabled` to `src/lib/server/config/index.ts` through all six touchpoints: `AppConfig`, `ENV_MAP` (`FUN_ENABLED`), `DEFAULTS` (false), `WRITABLE_KEYS`, `resolveConfig` (`toBool`), and `PublicConfig` + `publicConfig()`
- [x] 1.2 Add `libraryDefaultSort` through the same six touchpoints (`LIBRARY_DEFAULT_SORT`, default `'title'`), validating against the library sort values with fallback to `title` on invalid/unset
- [x] 1.3 Settings page "advanced" tab (`src/routes/settings/+page.svelte`): Fun checkbox toggle + default-sort `<select>`, both with env-managed disabled state, state from `data.config`, entries in the `save()` payload

## 2. Sync plumbing (watched + date added)

- [x] 2.1 Add `watched?: boolean` and `addedAt: Date | null` to `ServerItem` in `src/lib/server/media-server/types.ts`
- [x] 2.2 Map both in the Plex provider (watched: movie `viewCount > 0`, show `viewedLeafCount >= leafCount`; `addedAt` from the epoch field; missing → false/null)
- [x] 2.3 Map both in the Jellyfin/Emby providers (`UserData.Played`, `DateCreated` in `emby-parse.ts`; request the fields in item listings if not already fetched; missing/invalid → false/null) and extend the `emby-parse` tests
- [x] 2.4 Add `watched` integer-boolean (default 0) and `added_at` timestamp (nullable) columns to `mediaItems` in `src/lib/server/db/schema.ts`; generate one migration with `bun run db:generate`
- [x] 2.5 Persist both fields from `ServerItem` during library sync (full and incremental paths)

## 3. Library date-added sort

- [x] 3.1 Add `'added'` to `LibrarySort` and `orderFor` in `src/lib/server/queries.ts` (natural direction desc per `defaultSortDir`; nulls last) and to `SORTS` in `src/routes/library/+page.server.ts`
- [x] 3.2 Use the configured `libraryDefaultSort` in the library loader when no `sort` URL param is present (URL param wins)
- [x] 3.3 Add the "Date added" option to the sort select and `sortLabels` in `src/routes/library/+page.svelte`

## 4. Picker query

- [x] 4.1 Add `pickRandomItem(filter)` to `src/lib/server/queries.ts`: conds for type, `json_each` genre match, `gte`/`lte` year range, `eq(watched, false)` when excluding watched; `ORDER BY random() LIMIT 1`
- [x] 4.2 Unit-test the filter-cond building and default-sort validation as pure functions (keep tests `$env`-free per project convention)

## 5. Fun route

- [x] 5.1 Create `src/routes/fun/+page.server.ts`: 404 when `funEnabled` is off; parse type/genre/yearMin/yearMax/excludeWatched/pick-nonce from URL params; return genres list (reuse `listGenres()`) and the picked item when a pick is requested
- [x] 5.2 Create `src/routes/fun/+page.svelte`: filter controls (type select, genre select, year min/max inputs, watched checkbox) using `.input`/`.btn`/`.chip` tokens and the library-page URL-param pattern; pick + re-roll buttons
- [x] 5.3 Render the result card image-forward (poster with placeholder fallback, title, year, type badge, genres, rating, overview) with a link to `/item/[id]`, plus the localized empty-match state

## 6. Navigation

- [x] 6.1 Expose `funEnabled` from `src/routes/+layout.server.ts` (via `resolveConfig`/`publicConfig`)
- [x] 6.2 Conditionally include the Fun link in the `links` array in `src/routes/+layout.svelte` with standard active-state styling

## 7. i18n

- [x] 7.1 Add `nav_fun`, `settings_fun_enabled`, `settings_library_default_sort`, `library_sort_added`, and all `fun_*` picker keys (filters, buttons, empty state, result labels) to `messages/en.json`
- [x] 7.2 Translate the same keys in `messages/es.json`, `messages/zh.json`, `messages/ja.json`, `messages/pt-BR.json` — keep the 5 catalogs at parity

## 8. Verification

- [x] 8.1 Run the quality gates: `bun run check` (0 errors), `bun run test`, `bun run build`, `bun run lint`
- [x] 8.2 Manual pass: default state has no Fun nav and `/fun` 404s; enable toggle → nav appears; each picker filter constrains picks; exclude-watched works after a fresh sync; date-added sort orders newest-first with null-data items last; configured default sort applies when the URL has none; UI verified in at least one non-English locale

## 9. Release (after merge)

- [x] 9.1 After release-please publishes the release, rewrite its body with `gh release edit` in the v0.6.0 "What's new" style: `## What's new in X.Y.Z`, bolded user-facing feature bullets in plain language, full-changelog compare link (not the raw commit list of the v0.5.0 style)

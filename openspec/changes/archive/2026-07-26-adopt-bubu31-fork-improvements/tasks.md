# Tasks: adopt-bubu31-fork-improvements

Each numbered group is one PR, merged in order. Every PR: full gates
(`bun run check` / `test` / `build` / `lint`), fallow via agent before push, signed
commits, `Co-authored-by` trailer(s) for the fork commits it ports, fork
acknowledgment in the PR body, no AI attribution.

## 1. Urgent: trust the ThePosterDB CDN (fork 4ec5b52)

- [x] 1.1 Add `images.theposterdb.com` to the trusted provider hosts in `src/lib/server/artwork-revisions/apply-coordinator.ts`, keeping the legacy hosts; port the fork's allowlist tests (`apply-coordinator.test.ts`) adapted to our file
- [x] 1.2 Regression test: a staged candidate URL on the CDN host passes the trust check; an unknown host is still rejected; verify an end-to-end TPDB apply against the dev server
- [x] 1.3 PR `fix(apply): trust ThePosterDB's CDN host for artwork bytes` with `Co-authored-by: Bubu31 <mathieu.busolin@hacksis.dev>`

## 2. Stability + small UX wins (fork 2a14c4d/7477e16/4698a5b, d95ecaa, df522f7, c849d09)

- [x] 2.1 Port `src/lib/server/db/write-queue.ts` (`serializeWrite`) verbatim; WAL pragma in `migrateDb()` for file-backed DBs; client `timeout: 5000`; wrap `logEvent`/`pruneEvents` and the discovery write paths in `posters/service.ts`; add a small unit test for queue ordering
- [x] 2.2 Re-apply the disabled-provider filter hunk by hand (LF) in `getItemDetail` (`src/lib/server/queries.ts`): filter `posterCandidates` to providers whose availability is `available`; add a test
- [x] 2.3 Item-page per-provider re-search button + `POST /api/items/[id]/discover` accepting `{providers[], forceRefresh}` filtered against known provider ids; port the route test; add the `item_refresh_provider` i18n key to all catalogs
- [x] 2.4 Reserved per-provider slots in `suggestion-store.ts` (`RESERVED_SLOTS_PER_PROVIDER = 2` inside the 8-cap, score order restored) with the fork's test
- [x] 2.5 PR `feat: discovery stability and per-provider controls` with `Co-authored-by: Bubu31 <mathieu.busolin@hacksis.dev>` and `Co-authored-by: LeGrosBubu <git@busolin.fr>`

## 3. ThePosterDB auth, real sets, collection sets (fork 7123d70, 3abcb71, a33c268, eb34b32, b80ee9f, 98db033, d88f58b, 66c713f, ec775bc, bf9d4c8, a7b7312, 3a13c9f)

- [x] 3.1 Port `theposterdb-auth.ts` (CSRF scrape, typed `ThePosterDbAuthError`) + `theposterdb-session.ts` (TTL cache, in-flight dedupe, invalidation) with their tests
- [x] 3.2 Config: `thePosterDbUsername`/`thePosterDbPassword` (+ `SECRET_KEYS`, env map, provider settings UI with the 5 i18n keys) — credentials optional; availability unchanged when absent
- [x] 3.3 Provider: authenticated fetch when a session resolves, anonymous otherwise; one re-auth retry on empty scrape; keep `bestThePosterDbResultId` strict matching
- [x] 3.4 Merge `CARD_RE` contributor-card parsing into our `parse.ts`: real `/set/<id>` keys, author attribution, webp/jpg dedupe, flat-scrape fallback; port fixtures + tests alongside our existing ones
- [x] 3.5 `groupByProvider` flattening for theposterdb (`posters/sets.ts`) + `defaultExpanded` (`posters/collapse.ts`) with tests
- [x] 3.6 Native collection TPDB candidates: port `native-artwork-source/candidates/plan/runtime/service` changes with per-provider host allowlists enforced in plan validation and byte fetch; port all tests
- [x] 3.7 Collection sets: port `theposterdb-collection.ts` + `theposterdb-collection-match.ts` (+ `__fixtures__/theposterdb-set.html`, single-quote regression) and the 3-tier member matcher with tests
- [x] 3.8 New `POST /api/collections/[id]/discover` (per-member best-effort, `{total, succeeded, failed}`) generalized provider scope + collection-page button + the 4 collection i18n keys; port route test
- [ ] 3.9 Browser-verify: TPDB login round-trip, a collection gaining a coordinated set family, re-search controls; then PR `feat(theposterdb): account sessions, real sets, and collection set matching` with `Co-authored-by: Bubu31 <mathieu.busolin@hacksis.dev>`

## 4. One-click apply (fork b532825, reworked)

- [x] 4.1 `requestApply()` in `src/routes/item/[id]/+page.svelte`: auto-confirm the single-item path only when the preview has zero warnings and zero skips; apply-and-next unchanged; add a component/route test for both branches
- [x] 4.2 PR `feat(item): apply warning-free plans in a single click` with `Co-authored-by: Bubu31 <mathieu.busolin@hacksis.dev>`

## 5. French locale (user-requested)

- [x] 5.1 Register `fr` in the inlang project settings; create full `messages/fr.json` at key parity (including all keys added in phases 2–4 and `footer_aquarela`); native-quality translations
- [x] 5.2 Verify locale resolver + language switcher pick up `fr` from the single source of truth; run the i18n parity gate
- [x] 5.3 Docs: add `fr` to `docs/astro.config.mjs` locales (incl. sidebar `translations` entries); translate the docs pages under `docs/src/content/docs/fr/`
- [x] 5.4 Update CLAUDE.md's locale list to en/es/zh/ja/pt-BR/fr
- [x] 5.5 PR `feat(i18n): add French across the app and docs`

## 6. Docs for adopted features (user-requested)

- [x] 6.1 Document ThePosterDB login (why, credential safety, env vars), collection discovery, per-provider re-search, and one-click apply in the English docs
- [x] 6.2 Translate the new/changed pages into es/zh/ja/pt-BR/fr
- [x] 6.3 PR `docs: cover ThePosterDB accounts, collection discovery, and apply flow`

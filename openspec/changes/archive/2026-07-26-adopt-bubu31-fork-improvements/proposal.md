# Proposal: adopt-bubu31-fork-improvements

## Why

The fork [Bubu31/posterpilot](https://github.com/Bubu31/posterpilot) (29 commits
ahead) contains substantial, mostly well-tested improvements we want upstream — and
one of them fixes a **live bug on our main**: PR #42 stores ThePosterDB candidates on
`images.theposterdb.com`, but the apply-coordinator's trusted-host allowlist only
knows `theposterdb.com`/`www.theposterdb.com`, so every ThePosterDB apply is silently
dropped at the trust check. The fork also proves demand from a French-speaking user
base (the author is French), motivating French as a sixth locale. All ported work is
credited to the fork author via `Co-authored-by` trailers and PR-body acknowledgment.

## What Changes

Ordered as delivery phases (each phase = one PR, independently mergeable):

1. **Urgent trust fix** (fork `4ec5b52`): add `images.theposterdb.com` to the
   apply-coordinator's trusted provider hosts (keep the old hosts for `ASSET_RE`
   fallback candidates), with the fork's tests.
2. **Stability + small UX wins** (fork `2a14c4d`/`7477e16`/`4698a5b`, `d95ecaa`,
   `df522f7`, `c849d09`):
   - SQLite `journal_mode=WAL` + an in-process write queue (`serializeWrite`)
     wrapping event logging and discovery writes — eliminates `SQLITE_BUSY` under
     concurrent provider discovery.
   - Hide stored candidates from providers that are disabled/unavailable in
     settings (one hunk in `queries.ts` — the fork's CRLF full-file rewrite is NOT
     merged, the hunk is re-applied by hand on LF).
   - Per-provider "re-search" button on the item page; `POST /api/items/[id]/discover`
     accepts `{providers[], forceRefresh}` filtered against known provider ids.
   - Reserve 2 candidate slots per provider inside the existing 8-per-member cap so
     high-scoring providers can't crowd others out entirely.
3. **ThePosterDB auth + real sets + collection sets** (fork `7123d70`, `3abcb71`,
   `a33c268`, `eb34b32`, `b80ee9f`, `98db033`, `d88f58b`, `66c713f`, `ec775bc`,
   `bf9d4c8`, `a7b7312`, `3a13c9f`) — **reworked**:
   - Optional ThePosterDB login: CSRF-scraping auth + session cache; credentials via
     settings UI or env; password AES-encrypted at rest. Anonymous scraping (today's
     #42 behavior) remains the fallback when unconfigured — credentials are NOT
     required, diverging from the fork.
   - Contributor-card parsing: real `/set/<id>` identity + author attribution per
     candidate; webp/jpg dedupe; keep OUR stricter year matching
     (`bestThePosterDbResultId` semantics) over the fork's first-hit fallback.
   - ThePosterDB group expanded by default on the item page.
   - Native collection posters from ThePosterDB alongside TMDB, with per-provider
     host allowlists enforced in plan validation and byte fetch.
   - Collection-set → member matching (3-tier fuzzy matcher, up to 6 contributor
     sets tried, best member coverage wins) injected through a new
     `POST /api/collections/[id]/discover` route + collection-page button
     (generalized — not hardcoded to ThePosterDB).
4. **One-click apply** (fork `b532825`) — **reworked safer variant**: the single-item
   apply auto-confirms only when the plan preview carries no warnings and no skipped
   targets; otherwise the confirmation dialog appears as today. Apply-and-next keeps
   its dialog always.
5. **French locale (app + docs)** — user-requested addition:
   - `fr` as a sixth Paraglide locale: full `messages/fr.json` catalog (including
     the ~10 new keys phases 2–4 add), locale registered in the inlang project.
   - Docs: `fr` Starlight locale with translated pages (Starlight falls back to
     English for anything untranslated).
   - Update CLAUDE.md's language list (en/es/zh/ja/pt-BR/fr).
6. **Docs for the adopted features** — user-requested addition: document ThePosterDB
   login setup, collection discovery, re-search buttons, and one-click apply in the
   docs across all six locales.

**Skipped from the fork** (with reasons recorded): Jellyfin artwork fixes
(`c7c17ab` — superseded by our #38/#40, credit as independent confirmation), debug
ping probes (temporary, already deleted at fork HEAD), personal Komodo
`compose.yaml`.

## Capabilities

### New Capabilities

None — everything lands in existing capabilities.

### Modified Capabilities

- `poster-providers`: ThePosterDB optional authenticated sessions; real set identity
  + author attribution; collection-set discovery and member matching; concurrent
  discovery writes must not fail on database contention (WAL + write serialization).
- `poster-application`: trusted artwork hosts include the ThePosterDB CDN
  (`images.theposterdb.com`); single-item applies auto-confirm only when the plan
  preview is warning-free.
- `web-ui`: per-provider re-search control on the item page; collection-page
  discovery control; candidates from disabled providers hidden; reserved
  per-provider candidate slots; ThePosterDB group expanded by default.
- `configuration`: ThePosterDB username/password settings keys + env overrides,
  password stored encrypted.
- `i18n`: French joins the locale set; catalog parity requirement becomes six
  languages.
- `documentation`: French docs locale; new feature documentation in all locales.

## Impact

- Server: `posters/providers/*` (auth, session, parse), `posters/service.ts`,
  `posters/sets.ts`, `collections/*` (native-artwork pipeline + new
  theposterdb-collection modules), `artwork-revisions/apply-coordinator.ts`,
  `db/index.ts` + new `db/write-queue.ts`, `events.ts`, `config/index.ts`,
  `queries.ts` (one hunk).
- Routes: `api/items/[id]/discover`, new `api/collections/[id]/discover`.
- UI: item page, collection page, provider settings, `posters/collapse.ts`.
- i18n: ~10 new keys × 6 catalogs + full new `messages/fr.json`; inlang project
  settings.
- Docs: `docs/astro.config.mjs` locales, new `fr/` content tree, feature pages.
- No Drizzle schema migrations; WAL is a runtime pragma (reversible); new config
  keys ride the existing settings KV store.
- Credit: `Co-authored-by: Bubu31 <mathieu.busolin@hacksis.dev>` (themes B–E, G) and
  `Co-authored-by: LeGrosBubu <git@busolin.fr>` (disabled-provider filter) on the
  PRs carrying their work, plus fork acknowledgment in each PR body.

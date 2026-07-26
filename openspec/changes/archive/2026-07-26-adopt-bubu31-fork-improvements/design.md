# Design: adopt-bubu31-fork-improvements

## Context

Bubu31/posterpilot branched at `08c73b1` and is 29 commits ahead. Our main has since
merged PRs #38–#45, which supersede the fork's Jellyfin fixes and already implement a
(stricter) two-step ThePosterDB scrape. Full analysis with per-theme verdicts lives in
the session's adoption report; the substance commits per theme are listed in
proposal.md's credit section. Because the bases diverged, **no fork commit
cherry-picks cleanly** — everything is re-applied by hand onto current main, with
`Co-authored-by` trailers carrying credit.

## Goals / Non-Goals

**Goals:**
- Fix the live ThePosterDB CDN trust bug immediately.
- Port the fork's stability (WAL + write queue), UX (re-search, slots, disabled
  filtering, one-click), and ThePosterDB depth (auth, real sets, collection sets),
  reworked where our main is already ahead.
- Add French (app + docs) and document the new features.
- Credit Bubu31/LeGrosBubu on every PR carrying their work.

**Non-Goals:**
- No port of the fork's Jellyfin fixes (superseded), ping probes (temporary,
  self-deleted), or personal `compose.yaml`.
- No Drizzle schema migrations; no departure from the settings KV store.
- No Weblate onboarding for French in this change (catalog ships machine-translated
  at native quality; Weblate refinement follows the existing community process).

## Decisions

- **Phased PRs, strictly ordered** (each independently green): (1) trust fix,
  (2) stability+UX, (3) TPDB auth/sets/collections, (4) one-click apply, (5) French,
  (6) feature docs. Rationale: phase 1 is urgent; phase 3 is large and riskiest;
  phases 5–6 touch every catalog and are noisy — bundling would make review
  impossible. Alternative (one mega-PR) rejected for review size and rollback
  granularity.
- **Credentials optional, not required** (diverges from fork): our #42 anonymous
  scrape works today; requiring login would regress unconfigured installs.
  Availability stays independent of credentials; authenticated fetch is an upgrade
  path. Auth/session/config machinery ports mostly intact (CSRF scrape, 90-min TTL
  session cache, in-flight dedupe, typed auth error).
- **Keep our strict year matching**: fork's `pickBestMatch` falls back to the first
  hit on year mismatch — rejected (the exact failure #42's `bestThePosterDbResultId`
  was built to avoid). Fork's `CARD_RE`/`SET_CARD_RE` parsing merges INTO our
  `parse.ts`, not over it.
- **Trust fix keeps legacy hosts**: `images.theposterdb.com` is added; the old
  `theposterdb.com`/`www.` entries stay for `ASSET_RE` fallback candidates.
- **queries.ts hunk re-applied by hand**: the fork file is a CRLF full-file rewrite;
  merging it would destroy history. One ~30-line hunk + imports, LF.
- **One-click apply, safer variant**: auto-confirm only when the preview has zero
  warnings and zero skips (fork skips the dialog unconditionally for single items).
  Preserves the overwrite-warning safety net while keeping the fast path fast.
- **Collection discover route generalized**: fork hardcodes
  `providers: ['theposterdb']` in the collection button; ours passes the provider
  scope through (default: all enabled) so the control is useful beyond TPDB.
- **French translation source**: machine-translated to native quality in-repo (same
  as how other locales are maintained between Weblate passes), `fr` registered in
  the inlang project settings and docs `astro.config.mjs` locales.
- **Write queue adopted verbatim**: 24-line promise chain; the fork's 3-commit
  evolution proved `busy_timeout` alone fails (libsql discards the native connection
  per `transaction()`). WAL applied only to file-backed DBs so in-memory test DBs
  are untouched.

## Risks / Trade-offs

- [TPDB scraping is inherently brittle; auth adds a login form dependency] → All
  parsers fall back gracefully (flat scrape / empty results + logged event); session
  invalidation + one retry on empty; provider failures never cross-contaminate.
- [Anonymous access may serve placeholder images (what pushed the fork to auth)] →
  If anonymous quality degrades again, credentials are the documented remedy; the
  provider stays opt-in and experimental.
- [One-click apply removes a human checkpoint on the happy path] → Only when the
  plan is warning-free; any warning/skip restores the dialog. Two-phase server
  protocol untouched.
- [French catalog is large (~930 keys) and machine-translated] → Weblate remains the
  refinement channel; parity is enforced by the existing i18n gate.
- [WAL changes on-disk journal mode] → Reversible pragma; skipped for in-memory DBs;
  no migration.
- [Fork identities credited via Co-authored-by must match real emails] → Emails
  taken from the fork's own commit objects (`mathieu.busolin@hacksis.dev`,
  `git@busolin.fr`).

## Migration Plan

Six PRs in order; each passes the full gate suite before merge. Rollback = revert
the offending PR; no schema coupling between phases. Phase 3 depends on phase 2's
write queue only incidentally (adaptable); phase 6 documents whatever actually
merged.

## Open Questions

None — scope confirmed by the maintainer (all themes + French + docs updates).

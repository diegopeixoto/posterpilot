## 1. Planning baseline and database foundation

- [x] 1.1 Validate the complete change strictly and record a baseline run of check, test, build, and lint before application edits. (Baseline: strict OpenSpec valid; check 0 errors/warnings; 362 tests pass; build passes; lint reaches only untracked local `.agents`/`.codex` formatting.)
- [x] 1.2 Extend the Drizzle schema with server instances/scopes, operation plans, artwork snapshots/revisions, durable job fields/attempts, review intent/views, provider outcomes/diagnostics, schedules, backup records, resolution audit, and collection membership.
- [x] 1.3 Generate and review additive SQLite migrations, including the safe replacement of global `rating_key` uniqueness with server-scoped uniqueness and default-safe backfills.
- [x] 1.4 Add migration/integration tests proving idempotent legacy-server seeding, colliding source identifiers across servers, and preservation of existing media/history rows.
- [x] 1.5 Centralize data-directory/database-path discovery and early restore-marker handling before libsql opens the database.

## 2. Named media-server registry and strict scoping

- [x] 2.1 Implement encrypted server-instance CRUD, normalized-name validation, active-instance persistence, and idempotent materialization of legacy config as the protected default instance.
- [x] 2.2 Add server-management APIs for list/add/test/update/enable/disable/disconnect, with secret-preserving updates and structured errors.
- [x] 2.3 Extend `MediaServer` types/providers with instance identity, normalized capabilities, current background/child artwork metadata, and optional artwork read/delete operations used by verification and undo.
- [x] 2.4 Replace implicit global-provider resolution in sync, discovery, apply, diagnostics, jobs, and media routes with explicit validated server-instance resolution.
- [x] 2.5 Scope library/item/job/event/provider/collection/review queries and uniqueness rules by server instance and add wrong-scope rejection tests.
- [x] 2.6 Add the named-server Settings UI and shell switcher, keeping the one-server experience transparent and every new string localized.
- [x] 2.7 Implement previewed server purge impact, active-job blocking, disconnect retention, and a safe return to add-server setup after the last purge.
- [x] 2.8 Implement explicit identifier-based cross-server artwork target matching, preview, execution, isolated results, and never-title-only tests.

## 3. Exact operation plans and contract reconciliation

- [x] 3.1 Implement canonical JSON hashing and the expiring single-use operation-plan store with create/load/validate/consume/prune tests.
- [x] 3.2 Extract shared poster/background/child automatic selection with deterministic provenance and configurable provider/scoring inputs.
- [x] 3.3 Build one apply planner used by single, bulk, review, collection, and cross-server flows; it SHALL freeze discovery, target ids, slots, skips, defaults, and current-state fingerprints.
- [x] 3.4 Update apply preview/confirm APIs and jobs to execute only frozen plans, reject stale/replayed plans, and return exact per-item/per-slot summaries.
- [x] 3.5 Pass the effective default apply method to every loader/UI and API fallback; expose and persist scoring/provider-priority controls.
- [x] 3.6 Add regression tests for exact bulk preview versus execution, poster-plus-background auto-selection, no-candidate discovery, child mapping, and configured-default precedence.
- [x] 3.7 Implement Kometa structured preview tokens bound to selections/mode/source fingerprint and require explicit confirmation before sync/scaffold writes.
- [x] 3.8 Implement raw-editor preview/diff/confirm and backup-restore preview/diff/confirm with stale/content/replay rejection.
- [x] 3.9 Update Kometa UI so Sync/Save/Restore are available only from the matching visible preview and invalidate the preview after any input change.

## 4. Immutable artwork revisions, verification, and undo

- [x] 4.1 Implement content-addressed snapshot storage with owner-only files, deduplication, references, cleanup safety, and unit tests.
- [x] 4.2 Capture immutable original/prior server and Kometa states before every planned slot mutation, including absent values and custom uploads.
- [x] 4.3 Record append-only revision groups and per-destination/per-slot revisions with candidate provenance, structured outcome, verification, error, and undo linkage.
- [x] 4.4 Implement provider-aware post-write verification and update observed artwork state/version without claiming exact verification when only best-effort evidence exists.
- [x] 4.5 Version poster/background thumbnail URLs and invalidate scoped server/browser cache entries after verified apply or undo.
- [x] 4.6 Implement revision/history APIs and an item timeline UI covering show/movie, season, episode, server, Kometa, partial failure, and credentials-safe provenance.
- [x] 4.7 Implement exact undo planning/confirmation/execution for individual revision, slot, season, item, destination, and collection group without deleting prior history.
- [x] 4.8 Replace unlock-only revert UI/API behavior with revision-based undo and add server/Kometa restore, partial-failure, stale-plan, and Jellyfin/Emby tests.

## 5. Durable jobs and review-first automation

- [x] 5.1 Persist immutable job payload/result, server/library scope, plan/parent linkage, attempts, leases, available time, idempotency/dedupe key, and per-item outcomes.
- [x] 5.2 Refactor the runner to claim durable pending work, recover expired leases, resume safe units, and preserve interrupted non-idempotent work for review.
- [x] 5.3 Implement duplicate/conflict detection for sync/discover/apply/restore scopes and return the existing job when an equivalent request is active.
- [x] 5.4 Implement retry classification, bounded backoff/jitter, retry-failed-only payloads, cancellation semantics, and attempt history.
- [x] 5.5 Expose incremental versus full rescan, make full rescan preserve revisions and surface external changes, and block duplicate sync buttons server-side and client-side.
- [x] 5.6 Upgrade job SSE/progress to reconnect, announce queued/running/terminal states, expose sanitized failures/results, and support retry from Dashboard/job details.
- [x] 5.7 Implement persistent interval/daily/timezone schedule calculation, next-run/catch-up logic, occurrence idempotency, and due-occurrence polling.
- [x] 5.8 Implement review-only sync/discover automation execution, event/webhook coalescing, failure pause threshold, and no-auto-apply guarantees.
- [x] 5.9 Add Automation settings/history UI with per-server/library scope, next/last run, attempts, retry, open-result-view, and five-locale copy.

## 6. Provider outcomes, diagnostics, and manual matching

- [x] 6.1 Persist per-provider discovery outcomes and update candidates per provider so transient failures retain stale last-known-good results while successful empty results clear them.
- [x] 6.2 Separate aggregate `hasCandidates` from true `hasMediux`, backfill existing rows, and correct library filters, badges, dashboard stats, and documentation.
- [x] 6.3 Implement TMDB manual search, confirm/replace/clear pin, resolution reasons/audit, stale-candidate invalidation, and API tests.
- [x] 6.4 Add item/review manual-match UI with disambiguating metadata, confirmation, clear/replace behavior, and localized empty/error states.
- [x] 6.5 Implement bounded non-mutating diagnostics for each server, TMDB, providers, data/Kometa/backup paths, with structured health/capabilities/history.
- [x] 6.6 Add a Diagnostics settings view with independent progress, textual status, latency/last success, corrective hints, and accessible non-color indicators.
- [x] 6.7 Implement a redacted support-bundle exporter with safe manifest, optional title inclusion, omission-on-uncertain-sanitization, and secret-leak tests.

## 7. Persistent Review Inbox and actionable dashboard

- [x] 7.1 Implement review-state derivation/history and server-side inbox queries/counts for new, unresolved, no candidates, suggestion ready, staged, partial failure, external change, ignored, and completed.
- [x] 7.2 Implement saved review-view CRUD with normalized server/library/filter/sort definitions and validation.
- [x] 7.3 Build `/review` with server-side filters, totals/paging, saved views, image-forward cards, empty states, and actionable exception labels.
- [x] 7.4 Add stable review context/return state, previous/next navigation, scroll/focus restoration, and safe redirect validation to item detail.
- [x] 7.5 Add current/suggested/staged comparison UI and make suggestion acceptance explicit rather than silently persisting on page open.
- [x] 7.6 Add keyboard review actions that ignore editable controls, announce outcomes, preserve visible equivalents, and honor modal focus.
- [x] 7.7 Implement previewed Apply and next, advancing only after verified success and staying with retry detail on partial/failure.
- [x] 7.8 Replace passive Dashboard emphasis with localized next-action cards/counts for review states and failed jobs while retaining sync/job progress.

## 8. Truthful onboarding and scalable library controls

- [x] 8.1 Make setup step persistence check HTTP results, retain inline errors, derive resumable progress from valid configuration, and persist a real setup-dismissed state.
- [x] 8.2 Reuse `EmbyLogin` for Jellyfin/Emby username/password setup with API-key fallback and keep Plex PIN login provider-specific.
- [x] 8.3 Track first-sync `JobProgress` to terminal success/failure with retry and prevent “Skip for now” from redirecting back into setup.
- [x] 8.4 Move ignored state into the canonical server-side library filter/query/count and fix zero-visible-page pagination behavior.
- [x] 8.5 Display loaded range versus total, add select-page/clear/select-all-matching controls, and materialize select-all through an exact plan fingerprint.
- [x] 8.6 Preserve library filters/sort/scroll when opening item detail and add localized server-neutral empty/status/job copy.
- [x] 8.7 Complete remaining non-duplicate toast/skeleton/keyboard wiring and page-component extraction from the active feedback/refactor changes.

## 9. Expanded FUN experiment hub

- [x] 9.1 Move the FUN gate to a route layout and implement reusable validated filters for server/library/type/genre/year/runtime/rating/recency/presets, eligibility counts, stable seeds/ids, and bounded recent exclusions.
- [x] 9.2 Replace the one-result picker with up to three distinct shareable choices, field-level validation, dynamic library bounds, proxy images, presets, blind reveal, and capsule modes.
- [x] 9.3 Implement Poster Match with eligible-item selection, finite non-duplicating bracket, unavailable-candidate handling, restart/abandon, and winner staging that preserves other slots.
- [x] 9.4 Implement the full-screen ambient gallery with poster/background/mixed filters, proxy images, keyboard controls, pause/interval, load-failure skip, and reduced-motion-safe defaults.
- [x] 9.5 Implement the tested two/three-movie duration-budget planner with distinct results, known-runtime eligibility, combined duration, re-plan seed, and no-fit explanations.
- [x] 9.6 Add a quiet cinematic FUN hub/navigation for picker, poster match, gallery, and session planner with all copy localized and no direct apply path.

## 10. Collections and coordinated artwork

- [x] 10.1 Capture TMDB collection id/name during enrichment and persist server-scoped source-qualified collection membership with refresh/removal provenance.
- [x] 10.2 Extend providers with optional native collection/capability discovery without blocking TMDB-backed member work when unsupported.
- [x] 10.3 Build collection index/detail queries and image-forward UI showing provenance, local/unavailable members, current/staged artwork, and explainable consistency coverage.
- [x] 10.4 Implement coherent provider/author/family suggestion grouping, coverage ranking, per-member overrides, and explicit no-common-family behavior.
- [x] 10.5 Route coordinated member/native collection apply through exact plans, revisions, verification, partial results, and group/individual undo.
- [x] 10.6 Add collection scoping, stale-plan, mixed-server rejection, coverage, partial apply, and undo tests.

## 11. Application backup, restore, and readiness

- [x] 11.1 Implement consistent SQLite snapshot creation, manifest/checksums, key-mode handling, owner-only bundle storage, cleanup, and failure rollback.
- [x] 11.2 Implement backup inventory, validation status, protected/manual/safety flags, retention by count/age, deletion confirmation, and safe export.
- [x] 11.3 Implement restore preflight for checksums, SQLite integrity/schema, disk/path, key compatibility, migrations, external warnings, and exact confirmation binding.
- [x] 11.4 Implement maintenance-mode restore orchestration, mutating-job drain/block, protected safety backup, early-boot atomic replacement, rollback, and readiness report.
- [x] 11.5 Add Backup/Restore settings UI with create/list/validate/export/delete/restore actions, restart/maintenance guidance, and localized secret-bearing warnings.
- [x] 11.6 Add snapshot, retention, tamper, incompatible schema/key, rollback marker, and post-restore readiness tests.

## 12. Localization, accessibility, browser coverage, and documentation

- [x] 12.1 Add every new message key to all five catalogs at exact parity and replace remaining server-neutral Plex-specific or raw job/status strings.
- [x] 12.2 Add catalog-parity and locale-neutral persisted/API-state tests, including safe unknown-error fallback.
- [x] 12.3 Complete WCAG/keyboard/focus/status semantics for tabs, progress, dialogs, image candidates, gallery, review, diagnostics, backup, and server management.
- [x] 12.4 Add browser-level critical-flow coverage for setup, sync/full rescan, review/navigation, manual match, exact apply/undo, Kometa confirm/raw, FUN, automation, backup, collections, auth, and multi-server isolation.
- [x] 12.5 Update usage/configuration/installation/Kometa docs and add safety, automation/recovery, FUN/collections, and multi-server migration guides in supported documentation locales.
- [x] 12.6 Fill remaining `Purpose: TBD` text in affected main specs and reconcile active OpenSpec task checklists without duplicating or falsely completing manual work.

## 13. Verification, self-review, and delivery

- [x] 13.1 Run migration tests plus focused unit/route/browser suites after each implementation group and resolve regressions.
- [x] 13.2 Run `bun run check` with zero errors, `bun run test`, `bun run build`, and `bun run lint` successfully.
- [x] 13.3 Run manual smoke/a11y/reduced-motion checks against a seeded multi-server instance, including cache freshness, restore rollback, and exact preview/confirm flows.
- [x] 13.4 Validate OpenSpec strictly, self-review the full diff for secrets/migrations/i18n/scope safety, and update every completed task checkbox accurately.
- [x] 13.5 Create intentional conventional commits, push `codex/product-improvements`, and open a draft PR with risks, migrations, screenshots, and verification evidence; leave merge to the maintainer.

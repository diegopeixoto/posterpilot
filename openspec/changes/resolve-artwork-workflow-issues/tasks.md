## 1. TMDB Type-Safe Resolution and Manual Search

- [x] 1.1 Add expected media type to the automatic TMDB resolver contract and include it in typed cache identity
- [x] 1.2 Restrict direct TMDB ID validation and external-ID find parsing to the expected movie or TV namespace
- [x] 1.3 Pass authoritative item type through sync and manual-pin-clear callers while preserving user-confirmed pins
- [x] 1.4 Update resolution specs/tests that currently encode movie-first behavior, including equal numeric movie/TV IDs and empty expected buckets
- [x] 1.5 Make the manual-search year state consistently numeric-or-empty and move preparation/validation into handled error flow
- [x] 1.6 Add component or E2E coverage for changed, restored, cleared, invalid, repeated, empty-result, and failed manual searches
- [x] 1.7 Run the focused TMDB unit/integration tests and self-review the Phase 1 resolver diff

## 2. Selective Post-Upgrade TMDB Repair

- [x] 2.1 Implement and unit-test the server-scoped pending-mismatch predicate excluding manual pins and removed source items
- [x] 2.2 Add a durable TMDB-repair execution label/payload that reuses sync resolution while conflicting safely with other server-scoped sync work
- [x] 2.3 Force pending mismatches through resolution during repair and ordinary incremental sync without reprocessing unrelated unchanged items
- [x] 2.4 Re-check manual-pin state transactionally, invalidate stale candidates/selections on identity change, append resolution audit, and return changed identities to attention
- [x] 2.5 Expose per-active-server pending count and matching job state through server loads without using browser-local storage
- [x] 2.6 Build the localized non-dismissible shell banner with pending, running/retrying, incomplete, retry, job-detail, server-switch, and completed behavior
- [x] 2.7 Add integration/E2E coverage for multi-server isolation, restart durability, partial failure, cancellation, manual pinning during repair, and zero-count dismissal
- [x] 2.8 Run check/test/build/lint and relevant Playwright flows for the TMDB hotfix phase
- [x] 2.9 Replace the broad TMDB-repair covering index with a predicate-matching partial index and verify migration/query-plan behavior
- [x] 2.10 Reuse bounded server-scoped item lookup across retryable sync, discovery, apply, and automation paths with large-scope regression tests
- [x] 2.11 Reconcile repair state when a hidden document becomes visible, then rerun Phase 2 gates and independent review

## 3. Canonical Artwork Assets and Original-Resolution Application

- [x] 3.1 Add backward-compatible candidate preview-URL and language-provenance schema fields with migration and legacy defaults
- [x] 3.2 Extend provider candidate types and persistence to retain canonical URL, preview URL, provider asset ID, dimensions, language, and provenance state
- [x] 3.3 Implement a pure idempotent TMDB URL canonicalizer restricted to trusted HTTPS host/path patterns with comprehensive negative cases
- [x] 3.4 Canonicalize legacy TMDB selections before operation plan digest, destination fingerprint, preview, and revision creation
- [x] 3.5 Make candidate grids/thumb cache use preview URLs while direct server and Kometa execution use the frozen canonical destination URL
- [x] 3.6 Add streamed remote-artwork download limits, timeout/content-type enforcement, and redirect target revalidation
- [x] 3.7 Test new and legacy candidates across preview, direct apply, Kometa export, verification, history, undo, and non-TMDB/custom URL preservation
- [x] 3.8 Run check/test/build/lint and direct-apply E2E coverage for the original-asset phase

## 4. Typed Kometa Destinations and Split Files

- [x] 4.1 Verify the minimum supported Kometa metadata mapping syntax for movie TMDB, show TVDB, and IMDb fallback and record fixtures
- [x] 4.2 Implement the typed destination resolver using authoritative media-server kind, namespace, mapping ID, and stable movie/show filenames
- [x] 4.3 Add explicit skip/error outcomes for items lacking a Kometa-supported identifier
- [x] 4.4 Update YAML merge/write logic to isolate `posterpilot-movies.yml` and `posterpilot-shows.yml` while preserving unrelated content
- [x] 4.5 Carry versioned typed destination identity through frozen plans, file fingerprints, locks, previews, verification, revisions, and undo
- [x] 4.6 Preserve provable legacy revision destinations and reject unsafe legacy undo instead of inferring a split file
- [x] 4.7 Add a protective block that prevents new mixed-kind legacy exports from silently colliding while leaving direct apply available
- [x] 4.8 Finish Kometa config planning so each managed library references exactly one authoritative typed file, including a validated Kometa-visible relative prefix when required
- [x] 4.9 Test equal numeric movie/show IDs, provider-type disagreement, IMDb fallback, stale plans, per-file isolation, partial failure, and typed undo

## 5. Recoverable Kometa Migration

- [x] 5.1 Detect legacy file/config references and build a pure classifier using authoritative database mappings and revision provenance
- [x] 5.2 Build a redacted migration preview containing fingerprints, typed/re-keyed entries, ambiguous entries, split-file diffs, and per-library config changes
- [x] 5.3 Implement deterministic multi-file locking, fingerprint revalidation, backups, atomic split-file writes, and post-write verification
- [x] 5.4 Update backed-up `config.yml` only after both split files verify and make interrupted or failed migration retries idempotent
- [x] 5.5 Preserve `posterpilot.yml` untouched and expose an explicit rollback path through the config backup
- [x] 5.6 Provide exact manual config snippets and acknowledgment state when PosterPilot does not manage `config.yml`
- [x] 5.7 Build localized Kometa manager states for required, preview, ambiguous, stale, failed, manual-wiring, completed, and rollback guidance
- [x] 5.8 Add integration tests for confident and ambiguous classification, stale/cancelled preview, each write failure boundary, merge/own modes, manual config, and legacy preservation
- [x] 5.9 Run check/test/build/lint and Kometa browser flows for the split-file migration phase

## 6. TMDB Artwork Language and Complete Candidate Inventory

- [x] 6.1 Add validated `tmdbArtworkLanguage` configuration, `TMDB_ARTWORK_LANGUAGE` precedence, public config exposure, and any/ui/base-language normalization
- [x] 6.2 Persist TMDB file identity and tagged/untagged language provenance and refresh unknown legacy candidates before restricted filtering
- [x] 6.3 Replace the 20-result ingestion slice with stable validation/deduplication up to the measured per-kind guard and record truncation explicitly
- [x] 6.4 Measure high-volume fixtures and confirm or adjust the proposed 200-per-kind guard and 20-item disclosure batch
- [x] 6.5 Apply the resolved language policy to automatic selection, freeze it in plans, and expose foreign-language fallback metadata
- [x] 6.6 Add the global Provider setting and item-local Preferred/All control with explicit empty/fallback/refresh states
- [x] 6.7 Add independent poster/backdrop load-more state, remaining counts, stable append, live announcement, and unmounted hidden images
- [x] 6.8 Ensure filtering precedes batching/counts/suggestions and that every automatic suggestion is visible
- [x] 6.9 Add parser, persistence, configuration, ranking, payload-size, component, and E2E tests for language and progressive disclosure

## 7. Canonical Provider Ordering

- [x] 7.1 Sort provider groups explicitly from persisted priority and place unknown providers last without changing internal candidate order
- [x] 7.2 Test visual/default-expanded order against inverse provider completion and candidate insertion order
- [x] 7.3 Move the single order control to Provider settings and clarify its presentation/equal-score behavior separately from score weights
- [x] 7.4 Implement handle-only Pointer Events drag for mouse/touch without adding a dependency or blocking page scroll outside the handle
- [x] 7.5 Keep always-visible 44px move buttons, disabled-provider positions, focus continuity, position text, polite announcements, reset default, and reduced-motion behavior
- [x] 7.6 Add unit/component/E2E coverage for save/reload, buttons, drag, touch scroll, boundaries, disabled providers, unknown providers, and unchanged unequal-score ranking

## 8. Accessible Full-Size Candidate Preview

- [x] 8.1 Refactor each candidate card into a non-interactive wrapper with sibling selection and preview controls for every supported slot kind
- [x] 8.2 Build a reusable localized modal with on-demand canonical image loading, object-contain layout, provider/dimension/language/position metadata, and error state
- [x] 8.3 Implement focus trap/restore, Escape/close/backdrop behavior, body-scroll lock, shortcut suspension, and reduced-motion-safe transition
- [x] 8.4 Add previous/next navigation limited to the current filtered and disclosed sequence with position announcements
- [x] 8.5 Add E2E coverage proving preview never stages artwork and works with mouse, keyboard, touch-sized controls, navigation, failure, and focus restoration

## 9. Artwork Coverage Projection and Queries

- [x] 9.1 Add an indexed rebuildable coverage projection keyed by canonical kind/TMDB identity, occurrence, destination, and artwork slot
- [x] 9.2 Implement canonical occurrence grouping that preserves server/library provenance, separates movie/show numeric collisions, and never title-matches unresolved items
- [x] 9.3 Reconcile direct-server coverage from immutable revisions and current verified fingerprints into applied, unverified, externally-changed, missing, or unknown evidence
- [x] 9.4 Reconcile Kometa coverage from current typed files and only provable legacy entries into exported, missing, or unknown evidence without implying execution
- [x] 9.5 Trigger or refresh reconciliation after sync verification, apply, undo, Kometa migration/config inspection, and stale on-demand reads
- [x] 9.6 Add server/library occurrence counts and coverage filters to library/review queries without mutating `reviewedAt`
- [x] 9.7 Backfill/rebuild coverage safely for existing revisions and destinations while leaving ambiguous legacy entries unknown
- [x] 9.8 Test duplicate identities across servers/libraries, movie/show ID collisions, partial slots, external changes, parse failures, entry removal, and review-state independence

## 10. Coverage and Workflow UI

- [ ] 10.1 Add localized text-and-icon coverage badges for applied-on-this-server, exported-to-Kometa, externally-changed, unverified, missing, and unknown states
- [ ] 10.2 Add library/review filters for destination coverage and needs-artwork with URL persistence and accessible empty states
- [ ] 10.3 Add item-detail destination/slot breakdown and occurrence counts without collapsing server and Kometa evidence
- [ ] 10.4 Ensure no YAML-only state is labelled applied or completed and no state relies on color alone
- [ ] 10.5 Add component/E2E coverage for filtering, multi-occurrence details, unknown evidence, semantic labels, and assistive-technology names

## 11. Documentation, Localization, and Final Verification

- [ ] 11.1 Add every new/changed message to en, es, zh, ja, pt-BR, and fr and run catalog-parity checks in each implementation phase
- [ ] 11.2 Document type-safe TMDB repair, banner semantics, manual pins, and why full rescan is only a fallback
- [ ] 11.3 Document original-versus-preview bandwidth behavior, artwork language policy, load-more limits, provider order semantics, and preview controls
- [x] 11.4 Document split Kometa files, mapping namespaces, migration/manual-wiring steps, ambiguity handling, backup, and rollback
- [ ] 11.5 Document exact coverage meanings and explicitly distinguish exported metadata from downstream application
- [ ] 11.6 Run `bun run fallow` and apply only unambiguous dead-code fixes
- [ ] 11.7 Run final `bun run check`, `bun run test`, `bun run build`, `bun run lint`, and all relevant `bun run test:e2e` flows
- [ ] 11.8 Self-review the complete diff for security, migration reversibility, multi-server scope, accessibility, i18n parity, and accidental unrelated changes
- [ ] 11.9 Confirm every implementation phase is fully represented by completed OpenSpec tasks and captured test evidence before delivery

## 12. Isolated Worktrees, Subagents, and Pull Requests

- [ ] 12.1 Refresh `origin/main` before each phase and create a fresh neutral `fix/`, `feat/`, or `docs/` branch in its own worktree, never an agent-branded branch
- [ ] 12.2 Run the OpenSpec apply workflow from the phase worktree and assign subagents bounded investigation, disjoint implementation, focused testing, and final-review responsibilities
- [ ] 12.3 Keep one coordinator responsible for integration and prevent subagents from editing the same files concurrently
- [ ] 12.4 Run the phase-specific tests and required check/test/build/lint/E2E gates inside that worktree and self-review the complete diff before publishing
- [ ] 12.5 Create signed Conventional Commits with only the maintainer's configured identity and no co-author, agent, or session trailers
- [ ] 12.6 Push and open the PR only after the worktree is clean and tested, including OpenSpec task range, test evidence, migration/rollback notes, and maintainer-owned merge status
- [ ] 12.7 Link PRs explicitly with separate valid keywords for `#61` and `#64`, `#63`, the foundation/final `Refs #66` and `Closes #66`, `#62` and `#68`, `#65`, and `#67` according to the documented PR boundaries

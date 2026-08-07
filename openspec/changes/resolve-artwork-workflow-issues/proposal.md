## Why

Recent user reports expose two data-integrity risks—media resolved against the wrong TMDB namespace and movie/show Kometa metadata sharing an ambiguous numeric key—alongside artwork browsing gaps that hide results, apply reduced images, and make destination coverage difficult to trust. Addressing them together establishes one type-safe artwork identity and asset model before adding the requested browsing and tracking UX.

## What Changes

- Make automatic TMDB resolution respect the source item's movie/show type, make manual year-edited searches reliable, and selectively repair incompatible automatic matches after upgrade while preserving manual pins.
- Surface per-server TMDB repair work as a non-dismissible, localized banner whose state derives from durable pending records and job outcomes; retain full rescan only as an advanced fallback.
- Distinguish thumbnail/preview URLs from canonical apply URLs so TMDB artwork remains lightweight while browsing but uses the original asset for direct apply, Kometa export, verification, history, and preview enlargement.
- Preserve TMDB artwork language and provider asset metadata, add an independent preferred-artwork-language setting with explicit fallback, and expose all bounded results through incremental “load more” controls.
- Add an accessible full-size artwork viewer that does not stage a selection, including keyboard/touch operation, focus management, and reduced-motion behavior.
- Make the existing provider priority the canonical visual and tie-break order. Expose it with drag-by-handle plus always-available move buttons, stable disabled-provider positions, and clear scoring semantics.
- **BREAKING (migration-gated):** replace the ambiguous shared `posterpilot.yml` destination with media-kind-specific Kometa metadata files and identifiers, wire each managed library only to its compatible file, and provide an explicit previewed migration that preserves the legacy file and reports ambiguous entries.
- Add canonical artwork coverage across matching copies of a title, distinguishing direct server application from Kometa export without claiming that Kometa has executed, and expose coverage labels, counts, and filters in library/review workflows.
- Deliver the work in dependency-aware phases so urgent identity/output fixes can ship before the broader discovery and tracking UX.

## Capabilities

### New Capabilities

- `artwork-coverage`: Derive and present truthful artwork destination coverage across servers and libraries using canonical media identity and recorded/reconciled destination evidence.

### Modified Capabilities

- `tmdb-resolution`: Resolve only within the source media kind, support reliable edited-year manual search, and repair legacy automatic type mismatches safely.
- `background-jobs`: Selectively reprocess legacy automatic TMDB mismatches with durable, server-scoped progress and retry behavior.
- `poster-providers`: Preserve canonical/preview asset identity and image language, return a bounded complete candidate set, and apply a deterministic provider order.
- `configuration`: Persist an independent TMDB artwork-language preference and the canonical provider order with normal validation and precedence rules.
- `poster-application`: Apply/export original provider assets and carry type-safe Kometa destination identity through plans, verification, history, and undo.
- `kometa-config`: Split generated metadata and library wiring by movie/show semantics and migrate legacy single-file installations through previewed, recoverable changes.
- `web-ui`: Add the repair banner, accessible provider reordering, language filtering, load-more controls, independent full-size preview, and coverage states/filters.

## Impact

- **Database and migrations:** versioned/scoped repair state or derived repair queries, destination identity/history changes, and any coverage projection needed for efficient library queries. Existing manual pins and immutable artwork history must remain intact.
- **Server workflows:** TMDB resolution/cache contracts, sync reprocessing decisions, candidate parsing/storage, operation-plan freezing, direct download safeguards, Kometa writers, config synchronization, verification, and undo.
- **Client workflows:** application shell, dashboard/job feedback, Provider settings, item candidate groups/cards, lightbox behavior, library/review cards and filters, and Kometa migration preview.
- **Compatibility:** existing `posterpilot.yml` remains untouched until an explicit migration is confirmed; legacy revisions remain restorable through their recorded destination rather than being re-inferred.
- **Delivery:** implementation is split across neutral `fix/`, `feat/`, or `docs/` branches in isolated worktrees, coordinated with scoped subagents, and submitted only after its own quality gates pass. PR bodies reference or close the corresponding GitHub issues; commits use only the maintainer's configured identity and contain no agent attribution or trailers.
- **Quality:** unit/integration coverage for namespace collisions and destination routing, component/E2E coverage for keyboard/touch flows and repair lifecycle, all six message catalogs kept in parity, documentation updated, and the standard check/test/build/lint gates plus relevant Playwright flows required.

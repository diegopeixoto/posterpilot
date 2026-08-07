## Context

The reported issues span four pipelines that currently share incomplete identity:

- Automatic TMDB resolution knows the source item type but does not pass it into the resolver. Direct numeric IDs and `/find` results therefore prefer the movie namespace, and incremental sync can preserve the wrong result indefinitely.
- Artwork candidates use one URL for thumbnail display, application, verification, and export. TMDB candidates consequently persist `w500`/`w1280` preview URLs as if they were canonical assets, while language and provider asset identity are discarded.
- Kometa export uses one `posterpilot.yml` keyed by an untyped number and wires that file into both movie and show libraries. Movie TMDB IDs and show identifiers have different semantics and can collide or be interpreted by the wrong library.
- Apply history, current media-server artwork, and current Kometa metadata contain useful but different evidence. The UI currently cannot aggregate it across duplicate occurrences without overstating what a YAML export proves.

The change also adds the requested discovery UX: preferred TMDB artwork language, access to results beyond the current ingestion cap, independent full-size preview, and configurable provider presentation order. The UI remains dark-only, image-forward, restrained, WCAG AA, and reduced-motion-safe according to `.impeccable.md`.

The implementation will be delivered as several branches/PRs under one OpenSpec change. Each phase must remain deployable and backward-readable; no phase may require all later UI work to preserve data integrity. Implementation never occurs in the maintainer's primary worktree: each PR receives a fresh isolated worktree and a neutral, purpose-based branch name with no `codex/`, `claude/`, or other agent-branded prefix.

## Goals / Non-Goals

**Goals:**

- Make automatic TMDB identity type-safe for Plex, Jellyfin, and Emby and repair affected legacy automatic matches without requiring a full rescan.
- Keep thumbnails efficient while freezing one canonical original asset through apply/export, verification, history, and undo.
- Preserve enough TMDB candidate provenance for deterministic language filtering and progressive disclosure.
- Establish one provider order for display and equal-score tie-breaking, with an accessible reorder interaction.
- Replace ambiguous Kometa destinations with media-kind-specific files and identifiers through a previewed, recoverable migration.
- Derive truthful, per-slot coverage across server occurrences and Kometa destinations without mutating review intent.
- Keep all new UI localized across the six catalogs and testable with keyboard, touch, and reduced motion.

**Non-Goals:**

- Automatically run Kometa or claim that a metadata entry has been consumed downstream.
- Automatically reapply or revert artwork after a TMDB identity repair.
- Delete the legacy `posterpilot.yml` or guess the type of an ambiguous legacy numeric key.
- Add a permanent unsafe single-file Kometa mode for mixed movie/show libraries.
- Replace the existing score model or make provider order override unequal candidate scores.
- Introduce infinite scrolling, a new drag-and-drop dependency, or global background rediscovery of every legacy TMDB candidate.
- Infer canonical identity from title/year when a media item is unresolved.

## Decisions

### 1. Deliver one program through dependency-ordered phases

The implementation order and intended issue linkage are:

1. `fix/tmdb-type-safe-resolution`: type-safe resolution, manual-search fix, and selective repair (`Closes #61`, `Closes #64`).
2. `fix/tmdb-original-assets`: canonical original asset planning and bounded download behavior (`Closes #63`).
3. `fix/kometa-typed-destinations`: typed Kometa destination and split writer foundation (`Refs #66`).
4. `feat/kometa-split-migration`: previewed migration and manager UX (`Closes #66`).
5. `feat/artwork-discovery-controls`: candidate provenance, preferred language, expanded inventory, and canonical provider order (`Closes #62`, `Closes #68`).
6. `feat/artwork-preview`: independent accessible full-size preview (`Closes #65`).
7. `feat/artwork-coverage`: coverage projection and library/review presentation after TMDB and Kometa identities are trustworthy (`Closes #67`).

The provider-order UI is technically independent and may be moved earlier, but its contract remains shared with automatic selection. Coverage intentionally follows the TMDB and Kometa work so it does not encode the current false cross-type relationships.

Before each PR, the coordinator updates refs and creates its branch from the current `origin/main` in a dedicated worktree. The OpenSpec apply skill runs inside that worktree. Subagents receive bounded responsibilities such as code investigation, a disjoint implementation slice, focused test construction, or final diff review; one coordinator owns integration and prevents concurrent edits to the same files. A PR is created only after the phase-specific and repository quality gates pass and its diff has been self-reviewed.

Commits use Conventional Commits, the maintainer's configured and signed Git identity, and no `Co-Authored-By`, agent session marker, or other Codex/Claude attribution. Partial PRs use `Refs #N`; only the PR that completes an issue uses `Closes #N`. Each PR body includes its OpenSpec task range, migration/rollback notes where relevant, and exact test evidence. Merge remains the maintainer's decision.

**Alternative considered:** one large implementation PR. Rejected because the urgent identity/output fixes would wait for broad UI work and review/rollback would be unnecessarily risky.

### 2. Make expected media type mandatory throughout TMDB resolution

Every automatic resolver entry point will receive `expectedMediaType`, derived from the normalized source item (`movie` to `movie`, `show` to `tv`). Direct `tmdb://` resolution will validate only the expected endpoint. External-ID find parsing will select only the expected result bucket and return unresolved when that bucket is empty. Clearing a manual pin will load the source type and pass it through the same contract.

Resolution-cache identity will include expected media type. Existing untyped cache entries may be read only when their stored result matches the expected namespace; otherwise they are ignored and replaced by a typed entry. Manual search remains intentionally capable of explicit movie/TV choice because it is user-confirmed.

The manual search form will model the number input consistently as `number | null`; all normalization and validation will execute inside the handled search path so an unexpected preparation error becomes visible instead of an unhandled rejected promise.

**Alternative considered:** continue probing movie then TV and use title similarity to choose. Rejected because numeric IDs are namespace-qualified and title heuristics cannot make an authoritative source type safer.

### 3. Derive repair state from affected rows and use a targeted sync mode

Pending TMDB normalization is the server-scoped predicate:

```sql
manual_match_pinned = 0
AND source_removed_at IS NULL
AND (
  (type = 'show' AND media_type = 'movie')
  OR (type = 'movie' AND media_type = 'tv')
)
```

This count is the source of truth. It is preferable to a one-time boolean because it survives crashes, partial completion, server switching, restored backups, and manual intervention without reconciliation logic. No operational state will use browser storage.

The banner CTA will enqueue a server-scoped TMDB-repair execution that reuses the sync resolution/enrichment pipeline but filters work to current predicate matches and forces their resolution regardless of source timestamps. A normal incremental sync will also treat this predicate as a reason to reprocess, so pending rows cannot remain stuck if the user ignores the CTA. Full rescan remains an advanced fallback and continues to perform its broader artwork observation.

The repair execution will have a distinct durable public job label while conflicting with other sync/mutation work on the same server. Completion is determined by querying the predicate again, not merely by trusting a terminal job status. Corrected and safely unresolved units leave the count; failed/unprocessed units remain. Manual pins are checked again inside the transactional write.

An identity change invalidates candidates and pending selections, records the existing resolution audit, and returns the item to an attention/reviewable state. It never applies artwork. The shell banner is amber, concise, non-dismissible while pending, scoped to the active server, and changes between pending, running/retry-scheduled, incomplete, and complete states using durable job data.

**Alternative considered:** set a global post-upgrade flag and require a full rescan. Rejected because it is incorrect for multi-server and partial-failure cases and performs expensive resolution and artwork observation for unrelated items.

### 4. Store canonical destination assets separately from previews

For new candidates, the existing canonical candidate URL becomes the destination asset and a nullable `previewUrl` stores the optimized representation. TMDB discovery writes `/original/` as the canonical URL and `w500` or `w1280` as the preview. Browser cards render `previewUrl ?? url`; the lightbox fetches the canonical URL only when opened.

The candidate model will also persist provider asset ID and explicit language provenance. Because the existing nullable language column cannot distinguish a genuinely untagged image from legacy missing data, an additive language-provenance state (`tagged`, `untagged`, `unknown`) or equivalent boolean-known marker will be introduced. Existing rows start unknown; new TMDB rows are tagged or untagged.

For backward compatibility, plan construction includes a pure, idempotent TMDB canonicalizer before digest/fingerprint creation. It upgrades recognized legacy `https://image.tmdb.org/t/p/<size>/...` candidates to `/original/`. It accepts only HTTPS, the exact trusted host, and the expected path structure; custom and other-provider URLs remain byte-for-byte unchanged.

Direct downloads will stream with redirect revalidation, content-type checks, timeouts, and bounded byte limits. The canonical URL is frozen once and reused by operation execution, current-state verification, immutable revisions, and undo.

**Alternative considered:** rewrite TMDB URLs only inside the YAML writer. Rejected because preview, plan digest, direct apply, verification, and history would disagree about the actual mutation.

### 5. Preserve a bounded complete candidate inventory, then disclose progressively

TMDB's image response is not treated as paginated. Discovery will validate, deduplicate by provider file identity/path, preserve response order, and retain up to 200 candidates per artwork kind. Reaching the source guard is recorded as truncated in the provider outcome. The current fixed ingestion slice of 20 is removed.

The item UI initially discloses 20 candidates per provider/artwork-kind pane and appends 20 at a time. Filtering happens before visible/remaining counts. Hidden candidates do not mount image elements. The first implementation may serialize the bounded candidate metadata in the item payload because a 200-per-kind ceiling is acceptable for one detail page; payload size will be measured and a cursor endpoint can replace it later without changing the UX contract.

**Alternative considered:** issue synthetic page requests to TMDB from the load-more button. Rejected because the images response is already fetched as one inventory and fake pagination adds inconsistent cache/network behavior.

### 6. Keep artwork language independent from UI language while allowing a deterministic follow mode

`tmdbArtworkLanguage` accepts `any`, `ui`, or an explicit supported ISO 639-1 base code and is exposed through `TMDB_ARTWORK_LANGUAGE`. Existing and fresh installations default to `any`. `ui` resolves from the persisted application language; if no preference has yet been persisted, the active request locale is frozen for an interactive action and the configured fallback locale is used for unattended jobs. Regional UI locales normalize to their base image code.

Discovery always retains all bounded TMDB candidates. The preference controls default browsing and automatic-selection eligibility, not source ingestion. Preferred mode includes explicitly untagged images. Legacy candidates with unknown provenance prompt refreshed discovery rather than masquerading as neutral.

Automatic selection evaluates preferred/untagged TMDB candidates before foreign-language TMDB candidates and freezes the resolved language policy in the plan. A foreign-language fallback is permitted only when the preferred TMDB set is empty; the result carries fallback metadata and the UI makes the chosen candidate visible instead of highlighting a filtered-out card. The item-local Preferred/All control is ephemeral and never mutates global Settings.

**Alternative considered:** reuse the UI `language` setting directly. Rejected because interface locale and artwork language have different domains and users may want English artwork in a Portuguese UI.

### 7. Use one canonical provider order in presentation and equal-score ties

The existing persisted `providerPriority` remains the sole order. Provider groups are sorted explicitly at the grouping/query boundary after parallel discovery; discovery remains concurrent. Unknown provider IDs sort after configured providers with stable relative order. Disabled providers remain in Settings so re-enabling preserves position, but empty/disabled groups are not rendered on item pages.

The order affects the first expanded provider and provider tie-breaking only after normal candidate scores are equal. Settings moves the order control to the Providers section; score weights stay in Advanced with explanatory copy.

Rows use a dedicated pointer handle implemented with Pointer Events and `touch-action: none` only on that handle. Always-visible 44px move-up/down buttons are the baseline keyboard and assistive-technology path. Reordering preserves row focus, announces position through `aria-live`, uses the global Save transaction, and removes nonessential motion under `prefers-reduced-motion`. No drag-and-drop library is added for four rows.

**Alternative considered:** maintain separate visual and automatic-priority lists. Rejected because two nearly identical orders would drift and be difficult to explain.

### 8. Make full-size preview a sibling action, not a card side effect

Candidate markup becomes a non-interactive wrapper with sibling Select and Preview controls, avoiding nested buttons. The preview control is always touch-visible and may reduce visual prominence only on hover-capable devices. The modal reuses the project's dialog/focus patterns, locks body scroll, traps and restores focus, closes with Escape/close/backdrop, suspends page shortcuts, uses `object-contain`, and reports provider, dimensions, language, and position.

Previous/next navigation is limited to the currently filtered and disclosed list. The original asset loads on demand with a localized failure state. Motion is a restrained fade and becomes instant under reduced motion.

**Alternative considered:** make a click on the whole image preview and move selection elsewhere. Rejected because candidate click currently has a strong, efficient staging meaning and changing it would slow the primary workflow.

### 9. Route Kometa through a typed destination identity

The destination resolver returns:

```text
mediaKind + namespace + mappingId + filename
```

- Movie: `posterpilot-movies.yml`, TMDB ID, then IMDb fallback.
- Show: `posterpilot-shows.yml`, TVDB ID, then IMDb fallback.

Media kind comes from the authoritative media-server item/library type, never from the TMDB/provider match. An unsupported item is skipped visibly. A stable versioned destination key such as `kometa:v2:<kind>:<namespace>:<id>:<filename>` is carried through frozen plans, source fingerprints, locks, previews, revisions, verification, and undo.

Each managed Kometa library references exactly one compatible generated file. New exports never write the legacy shared file. Legacy revisions target their recorded legacy path when provable and never infer a split path from a numeric key.

The typed destination keeps the physical split basename independent from the Kometa-visible config reference. The migration/config workflow may add a validated relative mount prefix to that reference without changing the destination key or filesystem target.

**Alternative considered:** keep one file and prefix YAML keys with media type. Rejected because Kometa interprets mapping identifiers in library context and the same shared file would still be wired into incompatible libraries.

### 10. Migrate Kometa with config-last ordering and no destructive cleanup

Legacy detection opens a dedicated migration preview containing source fingerprints, confidently classified/re-keyed entries, ambiguous entries, new file diffs, and per-library config changes. Classification uses current database mappings and revision provenance, never only the numeric YAML key.

Confirmation acquires deterministic locks and performs:

1. Revalidate all source fingerprints.
2. Create backups and atomically write/verify both split files.
3. Back up and atomically update `config.yml` so each library points at its typed file.
4. Re-read files/config and persist the successful migration baseline.

Writing config last means a split-file failure leaves the active legacy configuration untouched. If config write fails, verified split files may remain safely unused and the idempotent migration can retry. `posterpilot.yml` is never deleted. In merge mode, only PosterPilot-owned references change; in own mode, the complete regenerated preview remains mandatory.

When PosterPilot does not manage `config.yml`, it generates the split files and exact snippets but records migration as awaiting manual wiring until acknowledged. While a mixed movie/show legacy reference remains active, new Kometa exports are blocked with the migration action; direct-server applies remain available.

**Alternative considered:** automatically rewrite every legacy entry during database migration. Rejected because collisions may already have destroyed type information and filesystem/config mutation must be explicitly previewed.

### 11. Build coverage as a rebuildable evidence projection

Canonical cross-occurrence identity is `(authoritative media kind, TMDB ID)`. It relates active copies across servers/libraries while never joining a movie and show with the same number. Kometa destination mapping remains separately typed and joins back through the media item.

A rebuildable `artwork_coverage` projection (or equivalently indexed derived store) records occurrence, destination, slot, status, evidence fingerprint/revision, and observation time. Its sources of truth remain immutable revisions, current media-server verification, and safely parsed current typed/legacy Kometa files. Only observed slots need rows; absence is computed against requested root/child slots.

Destination semantics are deliberately separate:

- `applied_on_server`: successful direct mutation whose current verified fingerprint still matches.
- `recorded_unverified` / `externally_changed` / `unknown`: history exists but current evidence does not prove coverage.
- `exported_to_kometa`: the current compatible metadata file contains the slot URL.
- `missing`: a reliable observation proves no current destination entry/evidence.

Kometa presence never becomes `applied_on_server`. Parse/read failures produce unknown, not missing. Reconciliation runs after sync verification, apply, undo, Kometa migration/config inspection, and on-demand stale reads. It never changes `reviewedAt`; workflow completion and destination evidence remain independent.

**Alternative considered:** add one mutable `applied` boolean to `media_items`. Rejected because it cannot represent multiple servers, libraries, destinations, slots, external changes, or unknown evidence.

### 12. Keep accessibility, localization, and observability inside each phase

Every new string is added to all six catalogs in the same PR. Semantic amber/red/emerald states pair color with text/icon. Banner and load-more updates use polite live regions; errors use alert semantics where immediate action is needed. Drag and modal behavior receive browser-flow tests, and all animation is reduced-motion-safe.

Repair, Kometa migration, truncation, language fallback, and coverage reconciliation emit locale-neutral event codes and safe structured context. Secrets and full signed/provider URLs are not added to client-visible logs or support bundles.

## Risks / Trade-offs

- **[TMDB repair increases API traffic]** → Process only predicate matches, reuse the durable queue/cache, apply normal throttling/retry, and leave full rescan optional.
- **[A source type is itself wrong]** → Treat normalized media-server type as authoritative for automatic behavior while preserving explicit manual pins as the escape hatch.
- **[Original assets are substantially larger]** → Load originals only for modal/apply, stream downloads with strict limits and redirect/host validation, and keep grids on optimized previews.
- **[More retained candidates increase database and SSR payload]** → Deduplicate, cap at 200 per kind, mount only visible images, measure serialized payloads, and keep a cursor endpoint as a compatible optimization.
- **[Legacy language nulls are ambiguous]** → Add explicit provenance state and refresh only affected item discovery when a restricted policy is used.
- **[Kometa collisions may already have lost data]** → Never guess; report ambiguous entries, preserve the legacy file, and require explicit reapplication.
- **[Multi-file migration is not one filesystem transaction]** → Revalidate fingerprints, lock deterministically, write/verify split files first, update backed-up config last, and make retry idempotent.
- **[Old revisions lack typed destination fields]** → Preserve and use explicit legacy paths where provable; disable only the unsafe undo unit rather than guessing.
- **[Coverage can become stale]** → Store observation time/evidence, reconcile on relevant mutations and reads, and expose unknown rather than optimistic completion.
- **[The umbrella change is broad]** → Keep phases independently releasable in isolated worktrees, use scoped subagents plus one integration owner, and do not advance a dependent phase until its data contract is stable and reviewed.

## Migration Plan

1. Add backward-compatible schema fields/tables for candidate preview/language provenance, typed destination identity, the repair job label/payload, and coverage projection. Take the normal pre-migration backup and keep readers compatible with legacy nulls/rows.
2. Deploy type-safe TMDB resolution and cache keys. Begin deriving per-server mismatch counts immediately; show the repair banner only where count is non-zero. Run selective repair by user CTA or next normal sync. Preserve pins and audit every identity transition.
3. Deploy the planning-boundary TMDB URL canonicalizer before changing discovery writes. New candidates then persist original canonical plus optimized preview URLs; legacy selections remain applicable through the canonicalizer.
4. Add the typed Kometa writer and collision guard. Existing shared-file installations remain readable/undoable but new mixed Kometa writes require the migration workflow.
5. Offer the split-file migration. Write and verify split files, then update backed-up config. Leave the legacy file untouched. For manual config management, require explicit acknowledgment after showing exact snippets.
6. Backfill/rebuild coverage from current revisions, server verification state, and safely parsed metadata destinations. Ambiguous legacy entries remain unknown.
7. Enable language controls, expanded inventory, provider ordering, lightbox, and coverage UI after their server contracts are deployed. Unknown-language legacy candidates refresh per item when needed.
8. Update documentation and release notes with repair behavior, Kometa migration/rollback, exact status meanings, artwork-language behavior, and original-image bandwidth implications.

Rollback strategy:

- Additive database changes remain readable by the forward version; do not roll back schema destructively.
- Before Kometa config migration, rollback is a code/image rollback because the legacy file/config remain active.
- After migration, restore the automatically created `config.yml` backup to point at the untouched legacy file; split files can remain unused.
- TMDB repair writes are append-audited identity corrections. Rollback does not silently restore known cross-type matches; users can use manual matching where a repaired identity needs adjustment.
- Coverage is rebuildable and can be dropped/recomputed without altering artwork, YAML, revisions, or review state.

## Resolved Questions

- The typed writer supports Kometa 2.0.0 and newer. Numeric mapping names are emitted as YAML integer scalars (TMDB in movie libraries, TVDB in show libraries); IMDb fallback uses canonical lowercase `tt...` mapping names in either library type. Fixtures cover the contract verified through Kometa 2.4.6.

## Open Questions

- Validate the proposed 200-per-kind provider guard and 20-item disclosure batch with real high-volume TMDB responses; constants may be lowered if measured payload or database costs exceed the detail-page budget without changing the specification.

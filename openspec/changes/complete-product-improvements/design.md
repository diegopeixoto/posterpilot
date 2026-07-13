## Context

PosterPilot is a SvelteKit/Bun single-process application backed by libsql/SQLite. Long-running work is represented in the database but scheduled through an in-memory queue; artwork application records outcomes but does not retain immutable prior bytes; Kometa writes have preview and backup primitives that the UI does not enforce; and most library/review state is derived from one active media server. The application already has provider abstractions, a media-server interface, encrypted secrets, background-job SSE, a thumbnail cache, and strong pure-module tests, so this change extends those seams instead of replacing them.

The primary stakeholder is the self-hoster curating many titles in a desktop browser. Correctness, recoverability, local-first operation, backwards-compatible Docker upgrades, WCAG AA, reduced motion, and keeping credentials out of browser payloads are hard constraints. Existing OpenSpec changes for feedback polish, page decomposition, auth hardening, and library performance remain authoritative for their unfinished non-overlapping tasks.

## Goals / Non-Goals

**Goals:**

- Make the previewed operation exactly the operation later executed and make every artwork/config write recoverable.
- Turn the repeated title-by-title journey into a fast, context-preserving review workflow.
- Preserve current zero-configuration single-server behavior while introducing named, isolated server instances.
- Keep automation review-first and durable across restarts.
- Reuse current metadata/candidates for useful, restrained FUN experiences.
- Add collection-level consistency, backup/restore, diagnostics, complete localization, and browser coverage.

**Non-Goals:**

- No hosted account, cloud sync, public social network, telemetry, or external recommendation service.
- No default unattended artwork application; schedules stop at sync/discovery/review readiness unless a future explicit policy is designed.
- No real-time multi-user voting or collaborative editing in the initial FUN implementation.
- No general-purpose image editor or generative artwork pipeline.
- No automatic merge of separate servers' media rows; cross-server actions match explicit TMDB identities and remain previewed.

## Decisions

### 1. One persisted operation plan drives preview and execution

Add an `operation_plans` table containing a UUID, kind, canonical JSON payload, SHA-256 digest, creation/expiry timestamps, and consumed timestamp. Preview endpoints build the complete operation list, persist it, and return its id/digest. Confirm endpoints accept only that plan id, reject expired/consumed/stale plans, and execute or enqueue the frozen operations.

For bulk automatic application, preview may discover and persist candidates because discovery is non-destructive library enrichment; the resulting artwork URLs and per-slot operations are frozen in the plan. The apply job never silently performs extra discovery or chooses different artwork after confirmation. Structured Kometa and raw-editor previews both produce the same plan shape and confirmation requirement.

_Alternatives:_ signed client tokens make large plans leak implementation data and complicate revocation; rebuilding a plan at confirmation recreates the current preview drift. A small persisted plan is inspectable, expirable, and testable.

### 2. Central planners are separated from executors

Create `$lib/server/plans/` modules for apply, Kometa, revert, and cross-server operations. Planners resolve defaults and produce neutral operations; executors consume only those operations. Pure helpers canonicalize/digest plans and summarize counts. Existing endpoints become adapters around the planners, while job tasks become executors.

This also fixes `DEFAULT_APPLY_METHOD`: loaders expose the resolved default, UI state initializes from it, and APIs use it only when the request omits a method. Poster and background auto-selection share one `autoSelectArtwork` function, including child slots.

_Alternative:_ patch each endpoint independently; rejected because preview/execution drift would remain easy to reintroduce.

### 3. Original artwork is stored as local content-addressed snapshots

Add `artwork_snapshots`, `artwork_revision_groups`, and `artwork_revisions`. Before a server write, the active provider reads the current slot bytes where available; PosterPilot stores them under the data directory by SHA-256 and records the prior slot state. Each revision records server instance, item, target (`server`/`kometa`), slot, before snapshot/value, after source/provenance, outcome, and verification state.

Extend the media-server interface with optional read/delete artwork methods and current-background/child-art metadata. Plex, Jellyfin, and Emby implement the strongest available behavior. An unavailable prior image is recorded explicitly rather than represented as a successful reversible state. Kometa revisions reference the exact backed-up file content and metadata entry before/after.

Undo is itself planned, confirmed, executed, and recorded as a new revision. History is never deleted. Snapshot files are reference-counted/pruned only after all retaining revisions expire under an explicit policy.

_Alternatives:_ keeping original URLs is unsafe because tokens/tags expire and sync overwrites them; relying only on server unlock semantics cannot restore Jellyfin/Emby or child artwork.

### 4. Verification is provider-aware and updates cache identity

After a direct write, the provider re-reads the slot. Where byte equality is meaningful, compare a digest; otherwise verify that the server reports a new non-empty artwork tag/URL and record `best_effort`. The media row receives a monotonically increasing `artworkVersion`, and thumbnail URLs include that version so immutable browser caching remains correct.

_Alternative:_ disable long browser caching; rejected because versioned immutable URLs preserve performance and correctness.

### 5. Review state is mostly derived, with only user intent persisted

Add `reviewedAt`, discovery status/timestamps, manual-match provenance, and external-change/verification markers to media items. Derive inbox buckets (`new`, `unmatched`, `no_candidates`, `ready`, `failed`, `external_change`, `applied`) from those fields, candidates, revisions, and job outcomes. Persist named filters in `review_views`, but do not duplicate every derived bucket in another state machine table.

Expose `/review` with server-side filtering, counts, stable ordered ids, and a compact review card. Item links carry a validated `returnTo` plus review view; server loaders resolve previous/next without trusting arbitrary redirects. “Apply and next” confirms the current frozen plan, then advances only on a successful or explicitly acknowledged partial outcome. Keyboard shortcuts ignore focused form controls and are fully labelled.

_Alternative:_ a mutable queue table for every item; rejected because it drifts when sync, discovery, or apply changes state outside the queue.

### 6. Library selections operate on a server-side snapshot of filters

Ignored state joins the canonical URL filter and database query. The UI always distinguishes loaded count from total. “Select all matching” submits the canonical filter plus a result-set fingerprint; the server resolves ids and stores them in an operation plan, so later pagination changes cannot alter the confirmed batch. Saved views persist normalized filter JSON.

_Alternative:_ keep accumulating ids in the browser; rejected because large libraries and infinite scroll make the selection incomplete and misleading.

### 7. Setup is a resumable server-validated state machine

Persist only completed-step intent in regular settings; the current step derives from missing prerequisites. Every step checks `res.ok` and server validation before advancing. Jellyfin/Emby reuse `EmbyLogin.svelte`; Plex reuses `PlexLogin.svelte`. The final step subscribes to `JobProgress` until a terminal status. “Skip” writes a setup-dismissed flag and the dashboard redirect honors it while displaying a configuration CTA.

_Alternative:_ a new wizard-session schema; rejected because configuration is already the durable source of truth and the wizard is single-user.

### 8. Provider availability and provider health are distinct

Rename aggregate `hasMediux` behavior to `hasCandidates` while retaining a true `hasMediux` projection for compatibility. Add `provider_status` keyed by provider and optional server instance, recording latency, attempt/success/error timestamps, status, and redacted error. Discovery updates candidates per provider transactionally: a successful empty result replaces that provider's candidates; a transient failure retains last-known-good candidates and marks them stale.

Diagnostics invoke bounded test operations for the active server, TMDB, enabled providers, and Kometa/data paths. A support-bundle endpoint returns version/platform, redacted config, statuses, recent jobs/events, and schema version; secrets and artwork URLs containing credentials are removed server-side.

### 9. FUN is an opt-in route group with reusable query primitives

Move the feature gate to `/fun/+layout.server.ts`. Generalize the picker into a pure filter parser plus query functions that return count, distinct stable ids, and no-repeat exclusions. `/fun` offers three choices with presets and optional blind reveal; `/fun/poster-match` runs a client-side tournament over discovered candidates and stages only the winner; `/fun/gallery` uses server-proxied images and a reduced-motion-safe manual/slow slideshow; `/fun/session` uses a tested bounded subset-sum heuristic for two or three movies within a duration budget.

Results encode selected ids in the URL, so refresh/back/share never redraw unexpectedly. Recent exclusions remain session-local and are never presented as learned recommendations.

### 10. Jobs become durable and idempotent before scheduling is added

Extend `jobs` with JSON payload/result, attempt/max-attempt, available-at, dedupe key, server instance, and parent/plan ids. Enqueue uses a partial unique/dedupe lookup for incompatible active work. The runner claims pending rows from SQLite, persists each attempt, retries retryable failures with bounded exponential backoff, and resumes pending work after restart; interrupted non-idempotent work is surfaced for review rather than blindly replayed.

Schedules live in `automation_schedules` with `interval` or `daily` cadence, next-run timestamp, action (`sync` or `sync_discover`), library/server scope, and enabled flag. A lightweight in-process scheduler polls due rows and advances `nextRunAt` transactionally. Optional per-schedule webhook tokens enqueue the same action. No schedule creates apply jobs.

_Alternatives:_ add a cron dependency or external Redis/worker; rejected because bounded daily/interval schedules satisfy the local single-process product and retain zero-setup deployment.

### 11. Backups are consistent folders and restore is restart-safe

Use SQLite `VACUUM INTO` (with WAL checkpoint fallback) to create a consistent database snapshot under `<data>/backups/<stamp>/`, copy `.app-key` when present, and write a manifest containing app/schema version, checksums, and non-secret metadata. List, validate, export, and retention operations never expose decrypted settings.

Restore first validates checksums/version, creates a safety backup, and writes a `restore-pending` marker. At the earliest point in database initialization—before opening libsql—the marker atomically replaces the database/key and is cleared. The UI reports that a container restart is required. Readiness checks include database write, key accessibility, snapshot directory, and configured Kometa paths.

_Alternative:_ replace a live SQLite file from the request handler; rejected because open connections and WAL state make it unsafe.

### 12. Collections begin as TMDB-backed consistency workspaces

Persist TMDB `belongs_to_collection` id/name during metadata enrichment and expose `/collections` for groups with at least two local members. A collection workspace shows member coverage and computes coherent candidate strategies using common provider/author before falling back to per-item scores. Users preview and stage/apply the member operations as one frozen plan. This delivers franchise consistency without requiring every media server's collection-container API in the first implementation.

_Alternative:_ start with Plex/Jellyfin collection objects; rejected because their semantics differ and would delay the cross-server-safe member workflow that provides the core value.

### 13. Multiple servers are introduced through a registry and active scope

Add `server_instances` with encrypted credentials, display name, type, URL, enabled flag, and timestamps. Add `serverInstanceId` to media items, jobs, provider status, schedules, revisions, and saved views; replace global `ratingKey` uniqueness with `(serverInstanceId, ratingKey)`. Existing environment/persisted single-server configuration is materialized as a protected legacy instance on first run and becomes the active instance.

All library/detail/job queries require an explicit server scope obtained from the validated active-instance setting. The shell offers a compact server switcher only when more than one instance exists. Cross-server apply matches items by pinned TMDB id, previews every target, and keeps separate revisions. It never infers identity from title alone.

_Alternatives:_ store several credential sets while leaving rows globally keyed; rejected because rating-key collisions corrupt state. Merge identical titles into one media row; rejected because watched/current artwork/library membership differ by server.

### 14. Migrations and delivery are staged but atomic to users

Land database/plan/revision foundations first, then reconcile current flows, then review/FUN/automation/backup/collections/multi-server UI. Each stage remains buildable and migration-compatible. Existing API shapes are retained where practical; mutating endpoints that now require a plan return a clear `409 preview_required` to old callers rather than performing an unpreviewed write.

No new runtime service is required. New filesystem writes stay inside the configured data directory. New UI copy lands in all five catalogs in the same commit as its feature.

## Risks / Trade-offs

- **Scope spans most product surfaces** → Implement in dependency order with separate task groups and conventional commits; reuse existing abstractions and avoid unrelated visual redesign.
- **Snapshot storage can grow** → Content-address bytes, deduplicate, expose retention/usage, and never prune referenced originals.
- **Provider verification differs** → Record exact vs best-effort vs unavailable instead of claiming uniform certainty.
- **Preview plans can become stale** → Short expiry, source fingerprints, one-time consumption, and explicit re-preview on mismatch.
- **In-process scheduling stops while the container is down** → Persist `nextRunAt`; enqueue one bounded catch-up run on restart instead of replaying every missed interval.
- **Multi-server migration can mix legacy data** → Seed one deterministic legacy instance before removing global uniqueness, back up automatically, and add isolation tests for colliding rating keys.
- **Restore requires restart** → Make the state explicit and leave the current instance untouched until early boot applies a validated marker.
- **Collection author consistency is incomplete when providers omit authors** → Show coverage and fallback decisions; never imply a complete matching set where none exists.
- **Large browser test matrix** → Cover critical golden paths in Playwright and keep lower-level planning/query logic in fast Vitest tests.

## Migration Plan

1. Create a pre-migration automatic database backup and add new tables/columns with nullable/default-safe values.
2. Seed the protected legacy server instance from the effective current configuration; assign every existing media/job/history row to it; replace the rating-key unique index.
3. Backfill `hasCandidates`, discovery status, artwork version, and review timestamps without changing visible applied state.
4. Deploy planners and revision capture behind the existing UI, then require plan confirmation once both preview and executor paths are live.
5. Enable review, diagnostics, FUN, schedules, backup, collections, and additional server management progressively; all new toggles default off except the review UI.
6. On rollback, keep additive tables/columns; the legacy active instance still maps to the old config. Do not roll back after creating multi-server-only rows unless those rows are exported or the operator confirms removal.

## Open Questions

- Live Plex/Jellyfin/Emby verification will determine which slots can claim byte-exact verification; unsupported cases remain explicitly best-effort.
- Cross-server background/child application is enabled only where both source identity and target child numbering resolve unambiguously; ambiguous targets remain skipped in the preview.

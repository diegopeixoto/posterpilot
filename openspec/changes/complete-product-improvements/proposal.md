## Why

PosterPilot already covers the artwork-management surface broadly, but several critical flows do not yet match their documented contracts and the repeated curation journey is still fragmented. This change closes the trust gaps first, then turns sync-to-apply into a review-first workflow and expands the optional FUN area and strategic self-hosting capabilities without compromising the quiet, cinematic product direction.

## What Changes

- Make every mutating Kometa and artwork operation previewable, confirmable, verifiable, and genuinely reversible, with immutable original-art snapshots and per-target revision history.
- Reconcile UI/API/spec behavior for default apply method, exact bulk previews, poster + background auto-selection, full rescans, provider semantics, thumbnail freshness, and localized status copy.
- Add an actionable review inbox and dashboard next-actions, preserving library context with previous/next, keyboard review, compare, “apply and next,” saved views, select-page/select-all, and retry-failed workflows.
- Make onboarding resumable and truthful: reuse username/password login for Jellyfin/Emby, validate every persistence request, follow the first sync to terminal completion, and make “skip” actually leave setup.
- Add manual TMDB matching and provider/server/filesystem diagnostics with last-success and failure visibility, while preserving last-known-good candidates during transient provider outages.
- Expand FUN into a small experiment hub: a richer three-option night picker, stable/shareable results, poster match, ambient gallery, blind/capsule picks, and duration-budget double/triple features.
- Add review-first scheduled/event automation, durable job payloads/results/retries, app backup/restore, collection/franchise artwork consistency, and simultaneous multi-server-safe state namespacing.
- Complete localization, accessibility, browser-level coverage, documentation, and the remaining non-duplicative validation work from active OpenSpec follow-ups.

No existing default will auto-apply artwork. Existing single-server installations migrate in place and continue to behave as one-server installations until another server is explicitly added.

## Capabilities

### New Capabilities

- `artwork-revisions`: Immutable original and revision snapshots, verified apply outcomes, history timeline, and real per-target undo for server and Kometa artwork.
- `review-inbox`: Stateful review queues, actionable dashboard summaries, context-preserving next/previous navigation, keyboard review, saved views, and apply-and-next.
- `provider-diagnostics`: Health, latency, credentials, last-success/error, writable-path checks, and a redacted support bundle for servers, providers, and Kometa.
- `fun-library-experiments`: Poster match, ambient gallery, blind/capsule picks, and duration-budget session planning inside the opt-in FUN section.
- `scheduled-automation`: Durable review-first schedules/events that sync and discover into the inbox, with persisted attempts, retry/backoff, and no default auto-apply.
- `app-backup`: Consistent application backup/restore covering SQLite state, configuration, encryption-key metadata, validation, retention, and readiness checks.
- `media-collections`: Collection/franchise discovery and coordinated artwork review/application for visually consistent sets.
- `multi-server-management`: Multiple named Plex/Jellyfin/Emby instances with server-scoped identities, libraries, jobs, artwork state, and optional cross-server application.

### Modified Capabilities

- `kometa-config`: Require preview then explicit confirmation for structured and raw writes, bind confirmation to the previewed content, and support reversible PosterPilot-managed metadata changes.
- `poster-application`: Honor configured defaults, make bulk previews exact, auto-select poster and background, verify writes, record provenance, and route undo through revisions.
- `background-jobs`: Prevent incompatible duplicates, persist payloads/results/attempts, expose errors and retry, support full rescans, and power scheduled work.
- `web-ui`: Add actionable dashboard states, scalable server-side filters/counts/selections, review navigation, comparison views, truthful job progress, and accessible controls.
- `media-server`: Unify setup login behavior, expose server capabilities/diagnostics, and associate every normalized item with a concrete server instance.
- `tmdb-resolution`: Let users search, confirm, pin, replace, and clear a manual TMDB match with an auditable resolution reason.
- `poster-providers`: Track per-provider outcomes, preserve last-known-good candidates on transient failures, and distinguish aggregate candidate availability from MediUX availability.
- `configuration`: Surface scoring controls, schedules, backup policy, named servers, and correctly apply configured defaults with environment precedence.
- `fun-random-picker`: Add library, runtime, rating, recency and preset filters; return distinct stable choices; avoid recent repeats; and report validation/match counts.
- `i18n`: Localize every new workflow and remove Plex-specific copy from server-neutral paths across all five catalogs.
- `documentation`: Document the corrected contracts, review workflow, expanded FUN tools, automation safety, backup/restore, collections, and multi-server migration.

## Impact

- **Database:** migrations for server instances/scoping, artwork snapshots/revisions, durable job payload/results/attempts, saved review views, provider status, schedules, backups, and collection membership.
- **Server/API:** new review, resolution, diagnostics, revisions, FUN, automation, backup, collection, and server-management endpoints; existing apply/sync/Kometa endpoints gain preview tokens, exact planning, dedupe, and verification.
- **UI:** Dashboard, setup, library, item detail, settings, Kometa, and FUN gain new flows and are decomposed into focused Svelte components as needed.
- **Operations:** safe in-place migration for existing databases; optional scheduler and multi-server functionality remain off until configured; backups stay local to the mounted data volume unless explicitly exported.
- **Quality:** pure modules remain `$env`-free; all five message catalogs stay at parity; browser tests cover setup, review, apply/undo, Kometa confirmation, FUN, automation, backup, and multi-server isolation.

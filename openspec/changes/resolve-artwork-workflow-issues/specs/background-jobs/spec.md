## ADDED Requirements

### Requirement: Selectively repair legacy automatic TMDB type mismatches

After an upgrade containing the type-safe TMDB resolver, the system SHALL durably identify, independently for each media-server instance, active unpinned items whose normalized source type conflicts with their stored automatic TMDB media type. A server-scoped repair action and the next normal sync SHALL reprocess those items even when their source timestamps are unchanged, without requiring a full rescan or reprocessing unrelated unchanged items solely for this repair.

#### Scenario: Legacy mismatches are detected after upgrade

- **WHEN** an upgraded server contains active unpinned shows resolved as TMDB movies or movies resolved as TMDB TV
- **THEN** those items enter that server's pending normalization set and remain pending across restarts until individually normalized

#### Scenario: Selective repair bypasses the incremental skip

- **WHEN** a pending mismatch has an unchanged media-server timestamp
- **THEN** the repair-capable sync reruns its automatic TMDB resolution while unrelated unchanged items remain eligible for the normal incremental skip

#### Scenario: Repair produces no safe expected-type match

- **WHEN** a pending mismatch has no TMDB result in its expected namespace
- **THEN** the repair marks it unresolved rather than preserving or replacing it with an opposite-type match

#### Scenario: Manual pins are excluded

- **WHEN** a mismatched item is already manually pinned or becomes pinned before its repair unit executes
- **THEN** the repair does not overwrite it and removes it from automatic normalization eligibility

#### Scenario: Repair is isolated by server

- **WHEN** multiple media-server instances contain pending mismatches
- **THEN** a repair action for one server processes and reports only that server's items and does not clear another server's pending state

#### Scenario: Repair changes identity

- **WHEN** repair replaces an item's stored TMDB identity or safely marks it unresolved
- **THEN** stale candidates and pending selections are invalidated, the resolution audit records the change, and no artwork is applied automatically

#### Scenario: Repair completes successfully

- **WHEN** all pending units for the targeted server are corrected, safely marked unresolved, manually pinned, or removed from the active source scope
- **THEN** the durable pending count for that server reaches zero

#### Scenario: Repair is partial or fails

- **WHEN** a repair job ends partial-failed or failed
- **THEN** successfully normalized units remain complete, failed units remain pending, and retry details remain available in job history

#### Scenario: Repair is cancelled or interrupted

- **WHEN** a repair job is cancelled, interrupted, or awaiting an automatic retry
- **THEN** completed units remain normalized, unprocessed units remain pending, and the durable job exposes its current state

### Requirement: Bound durable item-scope lookups

Durable sync, discovery, apply, and automation jobs SHALL validate explicit media-item ID scopes in bounded database batches below the supported SQLite/libSQL parameter limit. Every batch SHALL preserve the requested media-server scope, and the combined result SHALL reject missing or cross-server items before execution. Retry payload size SHALL NOT cause the same logical scope to be issued as one unbounded `IN (...)` query.

#### Scenario: A large retry payload is resumed

- **WHEN** a partial-failed job produces a retry payload containing more item IDs than one safe database batch
- **THEN** the runner validates the complete scope through multiple bounded queries and processes the same logical item set without exceeding the driver parameter limit

#### Scenario: A large scope contains an invalid item

- **WHEN** any batch contains a missing item or an item belonging to another media-server instance
- **THEN** scope validation rejects the job before processing and does not treat the valid batches as authorization for the invalid item

#### Scenario: A retry payload repeats item IDs

- **WHEN** a retry payload contains duplicate media-item IDs
- **THEN** scope validation deduplicates them deterministically before batching without processing the same item twice

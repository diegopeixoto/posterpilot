## ADDED Requirements

### Requirement: Incremental (diff-based) library rescan

The library sync job SHALL support an incremental mode that re-resolves and re-enriches only items
whose server modification timestamp changed since the last successful sync, while still pruning items
removed from the server. A full rescan SHALL remain available on demand.

#### Scenario: Unchanged items skipped

- **WHEN** an incremental sync runs and an item's server modification timestamp is unchanged since the last sync
- **THEN** the item's TMDB resolution and metadata enrichment are skipped

#### Scenario: Changed items reprocessed

- **WHEN** an incremental sync runs and an item's server modification timestamp is newer than the last sync (or unknown)
- **THEN** the item is re-resolved and re-enriched

#### Scenario: Full rescan forced

- **WHEN** the user requests a full rescan
- **THEN** every included item is reprocessed regardless of timestamp

### Requirement: Concurrent bulk apply

The apply job SHALL process items with bounded concurrency, while preserving live progress reporting,
cancellation, and per-item outcome recording.

#### Scenario: Items applied concurrently

- **WHEN** a bulk apply job runs over many items with a concurrency bound of N
- **THEN** up to N item operations run at once and progress is emitted as each item completes

#### Scenario: Cancellation honored mid-batch

- **WHEN** the user cancels a running concurrent apply job
- **THEN** no new item operations start and the job ends as cancelled

#### Scenario: Per-item failure isolated

- **WHEN** one item fails during a concurrent apply
- **THEN** its failure is recorded for that item and the remaining items continue

### Requirement: Jobs skip ignored items

Library-wide discover and apply jobs SHALL exclude items marked ignored.

#### Scenario: Ignored item not processed by a job

- **WHEN** a discover or apply job runs across the library
- **THEN** items marked ignored are not included in the job's work set

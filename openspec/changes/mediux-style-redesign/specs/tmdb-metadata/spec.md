## ADDED Requirements

### Requirement: Fetch display metadata for resolved items

The system SHALL fetch per-item display metadata from TMDB for each resolved item during library sync, capturing the overview, tagline, genres, runtime, rating (vote average), backdrop image URL, and top-billed cast. For shows the system SHALL also capture season and episode counts. The system SHALL reuse the TMDB detail response already fetched during resolution where possible, issuing additional TMDB requests only for fields not present in that response.

#### Scenario: Metadata captured during sync

- **WHEN** an item is resolved to a TMDB id during a library sync
- **THEN** the system reads overview, tagline, genres, runtime, rating, backdrop URL, and cast from the TMDB detail response and persists them on the item

#### Scenario: Show-specific counts

- **WHEN** a resolved item is a show
- **THEN** the system additionally persists the number of seasons and the number of episodes

#### Scenario: Missing metadata fields

- **WHEN** TMDB omits an optional field (e.g. no tagline or no rating) for an item
- **THEN** the system stores the available fields and leaves the missing ones empty without failing the sync for that item

### Requirement: Fetch a display logo

The system SHALL fetch a clearlogo image URL for each resolved item from the TMDB images endpoint, preferring an English-language logo, so the item page can display a logo in place of plain title text.

#### Scenario: Logo available

- **WHEN** TMDB has one or more logos for the item
- **THEN** the system selects a preferred (English where available) logo and persists its URL

#### Scenario: No logo available

- **WHEN** TMDB has no logo for the item
- **THEN** the system persists no logo URL and the item page falls back to rendering the title as text

### Requirement: Cache and refresh metadata

The system SHALL cache TMDB metadata requests through the shared HTTP cache so repeated syncs do not re-query already-enriched items, and SHALL re-fetch metadata when a forced refresh is requested for an item.

#### Scenario: Cached metadata reused

- **WHEN** an item was enriched in a previous sync and no forced refresh is requested
- **THEN** the system serves the cached TMDB responses without new network calls

#### Scenario: Forced refresh re-enriches

- **WHEN** a forced refresh is requested for an item
- **THEN** the system bypasses the cache, re-fetches the TMDB detail and images, and updates the stored metadata

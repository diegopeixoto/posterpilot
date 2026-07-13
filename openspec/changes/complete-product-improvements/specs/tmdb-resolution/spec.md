## ADDED Requirements

### Requirement: Search TMDB for a manual match

The system SHALL let the user search TMDB for movie or show candidates using a title and optional release year and media type. Results SHALL identify the TMDB ID and media type and SHALL include enough disambiguating metadata to choose safely, including localized title, original title when available, release year, overview, and poster when available. Searching SHALL NOT change the item's current resolution.

#### Scenario: Search with title and year

- **WHEN** the user searches for a title with a release year
- **THEN** the system returns matching TMDB movie and show candidates with their identifiers, media types, years, and available descriptive metadata without changing the item

#### Scenario: Search is restricted by media type

- **WHEN** the user restricts a search to movies or shows
- **THEN** the system queries and returns only candidates of the selected media type

#### Scenario: Search returns no candidates

- **WHEN** TMDB returns no results for the submitted search
- **THEN** the system reports an empty result and leaves the item's existing resolution unchanged

### Requirement: Manage a pinned manual TMDB match

The system SHALL let the user confirm and pin a search candidate, replace an existing manual or automatic match with another confirmed candidate, and clear a pinned manual match. A manual match SHALL be stored against the concrete media item and SHALL include the confirmed TMDB ID, media type, confirming timestamp, and resolution reason. Clearing a manual match SHALL preserve its audit event and make the item eligible for automatic resolution again.

#### Scenario: Confirm a manual match

- **WHEN** the user confirms a TMDB candidate for an unresolved or incorrectly resolved item
- **THEN** the system stores and pins that TMDB ID and media type with reason `manual`, invalidates candidate discovery derived from the prior resolution, and records the change

#### Scenario: Replace a match

- **WHEN** the user confirms a different TMDB candidate for an item that already has a resolution
- **THEN** the system replaces the active resolution, preserves the previous resolution in the audit history, and invalidates artwork candidates derived from the previous TMDB identity

#### Scenario: Clear a manual match

- **WHEN** the user clears a pinned manual match
- **THEN** the system removes the active pin, records the clear event, and reruns or queues automatic GUID-based resolution without restoring stale artwork candidates

#### Scenario: Candidate identity cannot be confirmed

- **WHEN** TMDB no longer returns the candidate selected for confirmation
- **THEN** the system refuses to pin it, reports that the candidate is unavailable, and leaves the current resolution unchanged

### Requirement: Audit resolution decisions

The system SHALL retain an append-only audit record whenever a resolution is created, refreshed to a different identity, manually pinned, replaced, cleared, or marked unresolved. Each record SHALL identify the item, previous and resulting TMDB identity when present, resolution reason, timestamp, and whether the action was automatic or user-confirmed.

#### Scenario: Automatic resolution is recorded

- **WHEN** a GUID resolves an item to TMDB
- **THEN** the system records the resulting TMDB identity and the GUID source that produced it

#### Scenario: Manual replacement is recorded

- **WHEN** the user replaces the active match
- **THEN** the system appends an audit record containing both the previous and resulting TMDB identities and reason `manual`

#### Scenario: Item remains unresolved

- **WHEN** every automatic resolution path returns no match
- **THEN** the system records an unresolved result with the attempted sources and failure reason

## MODIFIED Requirements

### Requirement: Resolve external GUID to a TMDB ID

The system SHALL resolve a Plex/external identifier (tmdb, imdb, or tvdb) to a canonical TMDB ID and media type (movie or show) and SHALL record the resolution reason. A pinned manual match SHALL take precedence over all automatic resolution and SHALL not be overwritten by synchronization or forced refresh. When no manual match is pinned and multiple GUIDs are present, the system SHALL prefer a direct TMDB GUID, then imdb, then tvdb.

#### Scenario: Pinned manual match

- **WHEN** an item has a pinned manual TMDB match
- **THEN** the system uses the pinned TMDB ID and media type with reason `manual` without querying or replacing it from external GUIDs

#### Scenario: Direct TMDB GUID

- **WHEN** an item has no manual pin and already carries a `tmdb://` GUID
- **THEN** the system uses that TMDB ID directly, classifies the media type by checking the TMDB movie endpoint and falling back to the show endpoint, and records reason `direct_tmdb_guid`

#### Scenario: External ID via TMDB find

- **WHEN** an item has no manual pin and carries only an imdb or tvdb GUID
- **THEN** the system calls the TMDB `find` endpoint with the matching external source, returns the resolved TMDB ID and media type, and records which external source resolved it

#### Scenario: Unresolvable item

- **WHEN** an item has no manual pin and TMDB returns no match for any available GUID
- **THEN** the system marks the item as unresolved and records the reason, leaving it eligible for a later retry or manual search

### Requirement: Cache TMDB resolutions

The system SHALL cache GUID-to-TMDB resolutions so repeated runs do not re-query TMDB for already-resolved items, and SHALL allow a forced refresh that bypasses the automatic cache. A pinned manual match SHALL remain authoritative outside that cache and SHALL only change through an explicit replace or clear action.

#### Scenario: Cache hit

- **WHEN** a GUID was resolved previously, is present in the cache, and the item has no manual pin
- **THEN** the system returns the cached TMDB ID without calling the TMDB API

#### Scenario: Forced refresh

- **WHEN** the user requests a forced refresh for an automatically resolved item
- **THEN** the system ignores the cached value, re-queries TMDB, updates the cache with the new result, and records a changed resolution when the identity differs

#### Scenario: Forced refresh with a manual pin

- **WHEN** the user requests a forced refresh for an item with a pinned manual match
- **THEN** the system retains the pinned identity and instructs the user to replace or clear the manual match rather than overwriting it

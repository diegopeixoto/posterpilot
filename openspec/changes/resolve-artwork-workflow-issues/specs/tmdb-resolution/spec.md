## ADDED Requirements

### Requirement: Search TMDB for a manual match

The system SHALL let the user search TMDB using the current title, optional release year, and selected media type. Every submission SHALL use the values currently shown in the form, remain usable after any valid edit or prior submission, and report candidates, an explicit empty result, or a localized error without changing the current resolution.

#### Scenario: Edit a pre-populated year

- **WHEN** the user changes the pre-populated year to another valid year and submits the search
- **THEN** the system searches using the edited year and renders candidates or an explicit empty-result state without requiring a reload

#### Scenario: Restore or clear the year

- **WHEN** the user restores the original year or clears the optional year after a prior search
- **THEN** another submission uses the restored year or omits the year respectively and completes without a reload

#### Scenario: Invalid year is rejected visibly

- **WHEN** the entered year is outside the accepted range or is not an integer
- **THEN** the system reports validation feedback, does not contact TMDB, and leaves the form usable for a corrected submission

#### Scenario: Unexpected search failure

- **WHEN** preparing or executing a valid manual search fails unexpectedly
- **THEN** the system renders a localized error, preserves the current match, and leaves the form usable for retry

## MODIFIED Requirements

### Requirement: Resolve external GUID to a TMDB ID

The system SHALL resolve a media-server identifier (`tmdb`, `imdb`, or `tvdb`) to a canonical TMDB ID and media type. Automatic resolution SHALL derive the expected TMDB namespace from the normalized source item type (`movie` to `movie`, `show` to `tv`) and SHALL NOT select a result from the opposite namespace. When multiple GUIDs are present, the system SHALL prefer a direct TMDB GUID, then IMDb, then TVDB. A pinned manual match SHALL remain authoritative and SHALL not be overwritten by synchronization, forced refresh, or upgrade repair.

#### Scenario: Direct TMDB movie GUID

- **WHEN** an unpinned movie carries a `tmdb://N` GUID
- **THEN** the system validates `N` only through the TMDB movie namespace and does not accept a TV result with the same numeric ID

#### Scenario: Direct TMDB show GUID

- **WHEN** an unpinned show carries a `tmdb://N` GUID
- **THEN** the system validates `N` only through the TMDB TV namespace and does not accept a movie result with the same numeric ID

#### Scenario: External ID via TMDB find

- **WHEN** an item carries only an IMDb or TVDB GUID and TMDB find returns results
- **THEN** the system selects a result only from the bucket matching the normalized source item type

#### Scenario: Expected namespace has no match

- **WHEN** the expected TMDB namespace contains no result but the opposite namespace does
- **THEN** the system marks the item unresolved rather than creating a cross-type automatic match

#### Scenario: Manual pin remains authoritative

- **WHEN** an item has a user-confirmed manual pin, including one whose media type differs from the normalized source type
- **THEN** automatic sync and upgrade repair preserve the pinned TMDB ID and media type unchanged

#### Scenario: Unresolvable item

- **WHEN** TMDB returns no match in the expected namespace for the selected GUID
- **THEN** the system marks the item unresolved, records the attempted source and reason, and leaves it eligible for later retry or manual matching

### Requirement: Cache TMDB resolutions

The system SHALL cache GUID-to-TMDB resolutions using both the external identifier and expected media namespace so repeated runs do not re-query TMDB for already-resolved items. A cached result from the opposite namespace SHALL never satisfy a lookup. The system SHALL allow a forced refresh that bypasses the compatible cache entry.

#### Scenario: Compatible cache hit

- **WHEN** a GUID was previously resolved for the same expected media namespace
- **THEN** the system returns the cached TMDB ID without calling the TMDB API

#### Scenario: Opposite-namespace cache entry

- **WHEN** a GUID has a cached movie resolution but the current source item is a show, or vice versa
- **THEN** the system ignores that entry and resolves within the expected namespace

#### Scenario: Forced refresh

- **WHEN** the user requests a forced refresh for an item
- **THEN** the system ignores the compatible cached value, re-queries TMDB within the expected namespace, and updates that cache entry

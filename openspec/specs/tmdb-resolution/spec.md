# tmdb-resolution Specification

## Purpose

Define authenticated TMDB identity resolution from media-server GUIDs and its cache behavior.

## Requirements

### Requirement: Resolve external GUID to a TMDB ID

The system SHALL resolve a Plex/external identifier (tmdb, imdb, or tvdb) to a canonical TMDB ID and media type (movie or show). When multiple GUIDs are present, the system SHALL prefer a direct TMDB GUID, then imdb, then tvdb.

#### Scenario: Direct TMDB GUID

- **WHEN** an item already carries a `tmdb://` GUID
- **THEN** the system uses that TMDB ID directly and classifies the media type by checking the TMDB movie endpoint and falling back to the show endpoint

#### Scenario: External ID via TMDB find

- **WHEN** an item carries only an imdb or tvdb GUID
- **THEN** the system calls the TMDB `find` endpoint with the matching external source and returns the resolved TMDB ID and media type

#### Scenario: Unresolvable item

- **WHEN** TMDB returns no match for any available GUID
- **THEN** the system marks the item as unresolved and records the reason, leaving it eligible for a later retry

### Requirement: Cache TMDB resolutions

The system SHALL cache GUID-to-TMDB resolutions so repeated runs do not re-query TMDB for already-resolved items, and SHALL allow a forced refresh that bypasses the cache.

#### Scenario: Cache hit

- **WHEN** a GUID was resolved previously and is present in the cache
- **THEN** the system returns the cached TMDB ID without calling the TMDB API

#### Scenario: Forced refresh

- **WHEN** the user requests a forced refresh for an item
- **THEN** the system ignores the cached value, re-queries TMDB, and updates the cache with the new result

### Requirement: Authenticate to TMDB

The system SHALL authenticate to TMDB using either a v4 bearer token (JWT) via the `Authorization` header or a v3 API key via query parameter, auto-detecting which based on the configured credential format.

#### Scenario: JWT credential

- **WHEN** the configured TMDB credential is a JWT (bearer token)
- **THEN** the system sends it in the `Authorization: Bearer` header

#### Scenario: API key credential

- **WHEN** the configured TMDB credential is a v3 API key
- **THEN** the system sends it as an `api_key` query parameter

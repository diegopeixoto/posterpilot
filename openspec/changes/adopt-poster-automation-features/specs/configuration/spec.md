## MODIFIED Requirements

### Requirement: Handle secrets safely

The system SHALL treat the Plex token, the Jellyfin API key, the Emby API key, and the TMDB
credential as secrets: storing them encrypted at rest (see the `secrets-encryption` capability),
never logging them, and never returning their full value to the client after they are stored.

#### Scenario: Secret not echoed

- **WHEN** the settings view loads after a token or API key has been saved
- **THEN** the system indicates a secret is set without returning the stored secret value to the browser

#### Scenario: Secret not logged

- **WHEN** the system logs requests or errors involving a media server or TMDB
- **THEN** the secret values (Plex token, Jellyfin/Emby API keys, TMDB credential) are redacted from all log output

#### Scenario: Secret not stored in plaintext

- **WHEN** a secret value is persisted to the settings store
- **THEN** the stored representation is encrypted at rest, not plaintext

## ADDED Requirements

### Requirement: Configurable behavior for adopted features

The system SHALL provide configuration, through the existing Settings precedence (environment
overrides persisted settings), for: poster scoring weights, the thumbnail-cache TTL/size bound, the
bulk-apply concurrency, and whether suggested pre-selection is enabled.

#### Scenario: Scoring weights configurable

- **WHEN** the user adjusts poster scoring weights in Settings and saves
- **THEN** subsequent scoring uses the new weights

#### Scenario: Apply concurrency configurable

- **WHEN** the user sets the bulk-apply concurrency in Settings
- **THEN** bulk apply runs with at most that many concurrent item operations, defaulting to a conservative value when unset

#### Scenario: Suggestion pre-select toggle

- **WHEN** the user disables suggested pre-selection in Settings
- **THEN** the item view no longer pre-selects a suggested candidate, leaving slots unselected by default

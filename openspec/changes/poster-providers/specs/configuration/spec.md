## ADDED Requirements

### Requirement: Per-provider artwork configuration

The system SHALL provide configuration for each artwork provider — an enable/disable flag per provider and the Fanart.tv API key — settable through the Settings UI and overridable by environment variables, consistent with the existing configuration precedence (environment overrides persisted settings).

#### Scenario: Toggle a provider

- **WHEN** the user enables or disables a provider in Settings and saves
- **THEN** the system persists that provider's enabled state and discovery honours it on the next run

#### Scenario: Fanart.tv key from environment

- **WHEN** a Fanart.tv API key is supplied via its environment variable
- **THEN** the system uses that key and reports the setting as environment-managed in the UI

#### Scenario: Secret key not echoed

- **WHEN** the Fanart.tv key has been saved
- **THEN** the Settings UI indicates it is set without revealing the stored value, matching how the Plex token and TMDB key are handled

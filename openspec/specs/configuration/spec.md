# configuration Specification

## Purpose

Define validated runtime and persisted configuration, environment precedence, secret handling, provider controls, and user preferences.
## Requirements
### Requirement: Provide and persist runtime configuration

The system SHALL accept runtime configuration — Plex base URL, Plex token, TMDB credential, Kometa assets directory, Kometa config-file path, Kometa config-management mode, default apply method, and preferred UI language — from environment variables and from the settings UI, and SHALL persist UI-entered values so they survive restarts. The Kometa config-file path locates Kometa's own `config.yml`; the `posterpilot.yml` metadata file is written into that file's directory (co-located), so there is **no separate metadata-path input**. The Kometa config-management mode SHALL be one of `merge` (default) or `own`. The preferred UI language SHALL be one of the supported locales; when set, it is the highest-precedence input to UI locale resolution.

#### Scenario: Configuration from environment

- **WHEN** configuration values are supplied via environment variables at startup
- **THEN** the system uses them as the effective configuration without requiring UI entry

#### Scenario: Configuration from UI persisted

- **WHEN** the user saves configuration in the settings UI
- **THEN** the system persists the values and applies them on the current and subsequent runs

#### Scenario: Environment overrides

- **WHEN** a value is set both in the environment and in persisted settings
- **THEN** the environment value takes precedence and the UI indicates the value is environment-managed

#### Scenario: Kometa config-file path configured

- **WHEN** a Kometa config-file path is supplied via its environment variable (`KOMETA_CONFIG_PATH`) or saved in the UI
- **THEN** the system uses it to locate Kometa's `config.yml`, applies the same environment-overrides-persisted precedence, and derives the `posterpilot.yml` location from that file's directory without a separate metadata-path setting

#### Scenario: Preferred language persisted

- **WHEN** the user sets a preferred UI language (via the settings UI or the header switcher) to one of the supported locales
- **THEN** the system persists it as the `language` setting and uses it as the highest-precedence input when resolving the UI locale on subsequent requests

#### Scenario: Preferred language from environment

- **WHEN** a preferred UI language is supplied via its environment variable
- **THEN** the system uses that locale as the configured preference and the UI indicates the value is environment-managed

#### Scenario: Invalid or unset preferred language

- **WHEN** the persisted or environment preferred-language value is absent or names an unsupported locale
- **THEN** the system treats the preference as unset and falls back to `Accept-Language` then English when resolving the UI locale, without error

### Requirement: Validate required configuration

The system SHALL validate that required configuration is present and well-formed before running operations that depend on it, and SHALL surface clear errors when it is missing. Server-connection validation SHALL target the credentials of the *active* server type only (Plex token+URL, or Jellyfin/Emby API key+URL).

#### Scenario: Missing active server configuration

- **WHEN** a library sync is attempted but the active server type's credentials are incomplete (e.g. type is `jellyfin` but no Jellyfin URL or API key)
- **THEN** the system blocks the operation and reports which credentials are missing for the active server type

#### Scenario: Missing TMDB credential

- **WHEN** TMDB resolution is attempted without a credential
- **THEN** the system blocks the operation and prompts the user to configure it

### Requirement: Handle secrets safely

The system SHALL treat the Plex token, the Jellyfin API key, the Emby API key, and the TMDB credential as secrets: never logging them, and never returning their full value to the client after they are stored.

#### Scenario: Secret not echoed

- **WHEN** the settings view loads after a token or API key has been saved
- **THEN** the system indicates a secret is set without returning the stored secret value to the browser

#### Scenario: Secret not logged

- **WHEN** the system logs requests or errors involving a media server or TMDB
- **THEN** the secret values (Plex token, Jellyfin/Emby API keys, TMDB credential) are redacted from all log output

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

### Requirement: Fun section toggle setting

The system SHALL provide a boolean `funEnabled` setting that gates the Fun section, defaulting to off. The setting SHALL follow the standard configuration behavior: settable from the settings UI and persisted, overridable via the `FUN_ENABLED` environment variable (environment takes precedence and the UI indicates the value is environment-managed), and exposed to the client through the public configuration.

#### Scenario: Default off

- **WHEN** neither the environment variable nor a persisted value is set
- **THEN** the effective `funEnabled` value is false

#### Scenario: Enabled from the UI

- **WHEN** the user turns the Fun toggle on in settings and saves
- **THEN** the system persists `funEnabled` as true and it survives restarts

#### Scenario: Environment override

- **WHEN** `FUN_ENABLED` is set in the environment and a different value is persisted
- **THEN** the environment value takes precedence and the settings UI shows the toggle as environment-managed

### Requirement: Default library sort setting

The system SHALL provide a `libraryDefaultSort` setting naming the sort the library grid opens with when the URL specifies none, defaulting to `title`. The setting SHALL follow the standard configuration behavior: settable from the settings UI and persisted, overridable via the `LIBRARY_DEFAULT_SORT` environment variable (environment takes precedence and the UI indicates the value is environment-managed), and exposed through the public configuration. The value SHALL be validated against the library's sort options (title, year, rating, runtime, recently changed, date added); an absent or invalid value SHALL fall back to `title` without error.

#### Scenario: Default sort applied

- **WHEN** the user sets the default library sort to `added` and opens the library without a sort URL parameter
- **THEN** the grid opens sorted by date added

#### Scenario: URL parameter wins

- **WHEN** a sort URL parameter is present
- **THEN** it takes precedence over the configured default

#### Scenario: Invalid value falls back

- **WHEN** the persisted or environment value names an unknown sort
- **THEN** the system treats the setting as unset and uses `title`, without error

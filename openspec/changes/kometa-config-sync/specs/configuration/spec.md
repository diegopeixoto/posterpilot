## MODIFIED Requirements

### Requirement: Provide and persist runtime configuration

The system SHALL accept runtime configuration — Plex base URL, Plex token, TMDB credential, Kometa assets directory, Kometa config-file path, Kometa config-management mode, default apply method, and preferred UI language — from environment variables and from the settings UI, and SHALL persist UI-entered values so they survive restarts. The Kometa config-file path is distinct from the Kometa assets directory: the assets directory is where PosterPilot writes its `posterpilot.yml` metadata file, while the config-file path locates Kometa's own `config.yml` that PosterPilot reads and updates. The Kometa config-management mode SHALL be one of `merge` (default) or `own`, selecting whether PosterPilot surgically updates only its sections or fully owns and regenerates the file. The preferred UI language SHALL be one of the supported locales; when set, it is the highest-precedence input to UI locale resolution.

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

- **WHEN** a Kometa config-file path is supplied via its environment variable (`KOMETA_CONFIG_PATH`) or saved in the settings UI
- **THEN** the system uses it to locate Kometa's `config.yml` independently of the Kometa assets directory, applying the same environment-overrides-persisted precedence and surfacing the env-managed indicator when set from the environment

#### Scenario: Preferred language persisted

- **WHEN** the user sets a preferred UI language (via the settings UI or the header switcher) to one of the supported locales
- **THEN** the system persists it as the `language` setting and uses it as the highest-precedence input when resolving the UI locale on subsequent requests

#### Scenario: Preferred language from environment

- **WHEN** a preferred UI language is supplied via its environment variable
- **THEN** the system uses that locale as the configured preference and the UI indicates the value is environment-managed

#### Scenario: Invalid or unset preferred language

- **WHEN** the persisted or environment preferred-language value is absent or names an unsupported locale
- **THEN** the system treats the preference as unset and falls back to `Accept-Language` then English when resolving the UI locale, without error

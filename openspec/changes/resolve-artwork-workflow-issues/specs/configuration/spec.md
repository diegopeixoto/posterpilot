## ADDED Requirements

### Requirement: Preferred TMDB artwork language

The system SHALL provide a TMDB artwork-language preference independent of the UI locale. The preference SHALL support all languages, following the current UI language, or an explicit supported ISO 639-1 language; SHALL default to all languages for existing and fresh installations; and SHALL follow persisted-setting and environment-override precedence.

#### Scenario: Artwork language saved

- **WHEN** the user selects a preferred TMDB artwork language in Settings and saves
- **THEN** the preference persists across restarts and becomes the default for TMDB artwork browsing and automatic selection

#### Scenario: Interface language selected

- **WHEN** the preference follows the UI language and the active locale contains a regional suffix
- **THEN** the system resolves it to the corresponding base artwork language, such as `pt-BR` to `pt`

#### Scenario: Preference is environment-managed

- **WHEN** the artwork-language environment variable is set
- **THEN** it overrides the persisted value and Settings indicates that the preference is environment-managed

#### Scenario: Preference is absent

- **WHEN** neither a valid environment nor persisted preference exists
- **THEN** the system uses all languages and preserves the prior browsing behavior

#### Scenario: Invalid language value

- **WHEN** a value is not a supported preference mode or valid supported language code
- **THEN** the UI rejects it or the runtime treats it as unset without applying an invalid filter

### Requirement: Persist canonical artwork-provider order

The system SHALL maintain one canonical ordered list containing every built-in artwork provider exactly once. The order SHALL persist through the Settings workflow, remain stable across restarts, default to MediUX, ThePosterDB, Fanart.tv, then TMDB, and retain disabled providers so their positions survive re-enablement.

#### Scenario: Provider order saved

- **WHEN** the user reorders providers and saves Settings
- **THEN** subsequent item views use that order for provider groups and deterministic provider tie-breaking

#### Scenario: Disabled provider retains position

- **WHEN** a provider is disabled and later re-enabled
- **THEN** it returns to its previously configured position

#### Scenario: Invalid provider order submitted

- **WHEN** an order omits, duplicates, or introduces an unsupported provider identifier
- **THEN** the system rejects it without replacing the last valid order

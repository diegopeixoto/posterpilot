# configuration Specification (delta)

## ADDED Requirements

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

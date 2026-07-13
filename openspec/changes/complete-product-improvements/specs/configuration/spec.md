## MODIFIED Requirements

### Requirement: Provide and persist runtime configuration

The system SHALL accept runtime configuration — legacy/default media-server connection values, named server instances, TMDB credential, artwork-provider controls and scoring, Kometa assets directory, Kometa config-file path, Kometa config-management mode, default apply method, preferred UI language, review automation settings, and application-backup policy — from environment variables where supported and from the settings UI, and SHALL persist UI-entered values so they survive restarts. For every setting with both sources, environment configuration SHALL override persisted configuration and the UI SHALL identify it as environment-managed. The Kometa config-file path locates Kometa's own `config.yml`; the `posterpilot.yml` metadata file is written into that file's directory (co-located), so there is **no separate metadata-path input**. The Kometa config-management mode SHALL be one of `merge` (default) or `own`. The default apply method SHALL be one of `server`, `kometa`, or `both` and SHALL be consumed by every apply surface when an action has no explicit override. The preferred UI language SHALL be one of the supported locales; when set, it is the highest-precedence input to UI locale resolution.

#### Scenario: Configuration from environment

- **WHEN** supported configuration values are supplied via environment variables at startup
- **THEN** the system uses them as the effective configuration without requiring UI entry

#### Scenario: Configuration from UI persisted

- **WHEN** the user saves configuration in the settings UI
- **THEN** the system validates and persists the values and applies them on the current and subsequent runs

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

#### Scenario: Default apply method is consumed

- **WHEN** the effective default apply method is `server` and an item, bulk, or review apply action omits a method override
- **THEN** the action preview uses `server` and no UI surface silently substitutes `both` or another method

#### Scenario: Invalid default apply method

- **WHEN** a persisted or environment default apply method is absent or not one of `server`, `kometa`, or `both`
- **THEN** the system uses the documented safe default, reports the invalid configured value without exposing secrets, and never broadens the action to an additional destination

### Requirement: Validate required configuration

The system SHALL validate that required configuration is present and well-formed before running dependent operations and SHALL surface clear errors when it is missing. Server-connection validation SHALL target the concrete named server instance selected by the operation (Plex token and URL, or Jellyfin/Emby API key and URL), and SHALL NOT allow credentials from one instance to satisfy another instance's validation.

#### Scenario: Missing active server configuration

- **WHEN** a library operation targets a named server whose credentials are incomplete (for example, type is `jellyfin` but no Jellyfin URL or API key is configured for that instance)
- **THEN** the system blocks the operation and reports which credentials are missing for that server instance

#### Scenario: Missing TMDB credential

- **WHEN** TMDB resolution is attempted without a credential
- **THEN** the system blocks the operation and prompts the user to configure it

#### Scenario: Another server has credentials

- **WHEN** a targeted server instance is incomplete but a different instance of the same type has valid credentials
- **THEN** the system still blocks the targeted operation and does not borrow the other instance's credentials

### Requirement: Handle secrets safely

The system SHALL treat every Plex token, Jellyfin API key, Emby API key, TMDB credential, Fanart.tv API key, and secret Kometa connector field as a secret scoped to its owning configuration or named server instance: it SHALL never log the value and SHALL never return its full value to the client after storage. Updating a non-secret field with a masked or omitted secret SHALL preserve the stored secret; clearing a secret SHALL require an explicit clear action. Diagnostics and support exports SHALL redact these values.

#### Scenario: Secret not echoed

- **WHEN** the settings view loads after a token or API key has been saved
- **THEN** the system indicates that the secret is set for its owning instance or connector without returning the stored value to the browser

#### Scenario: Secret not logged

- **WHEN** the system logs requests or errors involving a media server, provider, Kometa connector, or TMDB
- **THEN** all secret values are redacted from log output

#### Scenario: Named server is edited without replacing its secret

- **WHEN** the user changes a named server's label or URL and submits the masked credential unchanged
- **THEN** the system preserves that server's stored credential and does not replace it with the mask or an empty value

#### Scenario: Support bundle is generated

- **WHEN** configuration diagnostics are included in a support bundle
- **THEN** secret values and sensitive query parameters are redacted before the bundle is made available

## ADDED Requirements

### Requirement: Configure candidate scoring and provider priority

The system SHALL expose validated controls for deterministic automatic artwork selection, including ordered provider priority and bounded scoring weights for relevant candidate attributes. It SHALL persist the controls, apply environment-over-persisted precedence where an environment form exists, expose the effective values and their source, and use the same effective scoring configuration for preview and execution. Invalid or incomplete controls SHALL fall back to documented safe defaults without producing nondeterministic selection.

#### Scenario: Provider priority is saved

- **WHEN** the user reorders enabled artwork providers and saves settings
- **THEN** the system persists the order and the next automatic-selection preview uses it as a deterministic tie-breaker

#### Scenario: Scoring weight is environment-managed

- **WHEN** a scoring value is provided by a supported environment variable
- **THEN** the UI displays its effective environment-managed value and prevents a persisted value from overriding it

#### Scenario: Invalid weight is supplied

- **WHEN** a scoring weight is outside its allowed range or not numeric
- **THEN** the system rejects the persisted edit or ignores the invalid environment value, identifies the affected control, and uses its documented default

### Requirement: Configure review automations

The settings surface SHALL expose creation and management of named scheduled or event-driven review automations, including enabled state, server-library scopes, trigger and timezone, discovery inputs, review-view destination, retry policy, and consecutive-failure pause threshold. Automation records SHALL be persisted independently from global defaults so editing one automation does not change another, and no new automation SHALL default to applying artwork.

#### Scenario: Automation settings are persisted

- **WHEN** the user saves a valid review automation
- **THEN** its validated trigger, scope, timezone, discovery, destination, and retry settings survive restart and are available to the scheduler

#### Scenario: Invalid automation scope

- **WHEN** an automation references a server or library that does not exist or is disabled
- **THEN** the system blocks enabling it and identifies the invalid scope

#### Scenario: Automation defaults are safe

- **WHEN** the user begins creating an automation
- **THEN** its action is review-only and saving it cannot auto-apply artwork without a separately specified future capability

### Requirement: Configure application backup policy

The system SHALL expose application-backup configuration for enabled state, local destination within an allowed data location, schedule, retention count or age, and optional pre-upgrade backup. Where supported, environment values SHALL override persisted values and be identified as environment-managed. Saving the policy SHALL validate that the destination is writable and does not overlap unsafe transient or application-bundle paths before enabling scheduled backups.

#### Scenario: Valid backup policy is saved

- **WHEN** the user saves an enabled policy with a writable allowed destination, schedule, and retention limit
- **THEN** the system persists the policy and makes it available to the backup scheduler

#### Scenario: Backup destination is not writable

- **WHEN** the user attempts to enable backups to a destination that fails the writability check
- **THEN** the system rejects the enabled policy and reports the path check without creating a misleading ready state

#### Scenario: Retention is environment-managed

- **WHEN** backup retention is set by a supported environment variable and a different value is persisted
- **THEN** the environment value is effective and the UI identifies retention as environment-managed

### Requirement: Configure named media-server instances

The system SHALL let the user add, edit, enable, disable, select, and remove named Plex, Jellyfin, and Emby instances, each with an immutable internal ID, user-facing name, provider type, URL, scoped credentials, and optional connection settings. A name SHALL be unique among active instances. Legacy single-server environment or persisted settings SHALL migrate in place to one default named instance without changing its effective connection. Removing an instance with associated libraries, jobs, or artwork history SHALL require an explicit impact preview and SHALL preserve audit history according to retention policy.

#### Scenario: Existing single-server configuration migrates

- **WHEN** an installation with legacy single-server settings starts after the named-server migration
- **THEN** the system creates or resolves one default named instance with the same effective type, URL, and credential and continues to target it

#### Scenario: Add a second server

- **WHEN** the user saves a valid second named server with a unique name
- **THEN** the system persists a distinct internal identity and keeps its configuration and credentials isolated from the first server

#### Scenario: Duplicate active name is rejected

- **WHEN** the user attempts to save an active server with the same normalized name as another active instance
- **THEN** the system rejects the change and asks for a distinct name without altering either instance

#### Scenario: Server removal has dependencies

- **WHEN** the user requests removal of a server that owns libraries or history
- **THEN** the system shows the affected records and requires explicit confirmation before disabling or removing operational access while preserving required audit data

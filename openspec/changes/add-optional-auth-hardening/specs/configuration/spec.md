## ADDED Requirements

### Requirement: Internal authentication settings

The system SHALL persist authentication state (`authMode`, `authUsername`, `authPasswordHash`,
`authSessionVersion`) as internal key-value settings in the existing `settings` store, kept
**outside** the `AppConfig`/`ENV_MAP`/`WRITABLE_KEYS` machinery (the same convention as
`cachedLibraries` and the `kometa*` selections). These values SHALL NOT be exposed through the public
config sent to the browser, and the password hash SHALL NOT be returned to the client.

#### Scenario: Auth settings excluded from public config

- **WHEN** the client fetches the public configuration
- **THEN** the auth username, password hash, mode, and session version are not included

#### Scenario: Auth settings not env-mapped

- **WHEN** the system resolves configuration from the environment
- **THEN** the auth settings are not treated as `AppConfig` keys and do not require dedicated env
  variables (other than the `AUTH_MODE` override)

### Requirement: AUTH_MODE environment override

The system SHALL let an `AUTH_MODE` environment variable take precedence over the persisted `authMode`.
When set, it determines the effective mode and the in-app control SHALL reflect that the mode is
locked by the environment.

#### Scenario: Env override wins

- **WHEN** `AUTH_MODE` is set and differs from the persisted mode
- **THEN** the effective mode follows `AUTH_MODE` and the persisted value is ignored until the env var
  is removed

### Requirement: Secret key file permission guard

At startup the system SHALL check the encryption key file (`.app-key`) and, if it exists but is
group- or world-readable (looser than owner-only), SHALL log a prominent warning. The check SHALL be
advisory — it SHALL NOT prevent startup.

#### Scenario: Group- or world-readable key warns

- **WHEN** the app starts and the key file exists with group- or world-readable permissions
- **THEN** the system logs a prominent warning identifying the file and the risk, and continues to
  start

#### Scenario: Owner-only key is silent

- **WHEN** the app starts and the key file exists with owner-only (`0600`) permissions
- **THEN** the system does not warn about the key file

# configuration — delta

## ADDED Requirements

### Requirement: ThePosterDB credentials configuration
The system SHALL accept optional ThePosterDB credentials via settings
(`thePosterDbUsername`, `thePosterDbPassword`) and environment overrides
(`THEPOSTERDB_USERNAME`, `THEPOSTERDB_PASSWORD`), editable in the provider settings
UI. The password SHALL be treated as a secret: encrypted at rest like other secret
keys and never echoed back in plain text. Clearing the credentials SHALL return the
provider to anonymous mode.

#### Scenario: Credentials stored encrypted
- **WHEN** the user saves ThePosterDB credentials in settings
- **THEN** the password is persisted encrypted and the UI indicates the secret is set without revealing it

#### Scenario: Environment override
- **WHEN** `THEPOSTERDB_USERNAME`/`THEPOSTERDB_PASSWORD` are set in the environment
- **THEN** they take effect following the same precedence rules as other env-overridable settings

## ADDED Requirements

### Requirement: Encrypt secret settings at rest

The system SHALL store secret configuration values (media-server tokens/keys and provider API
credentials) encrypted at rest using authenticated encryption (AES-256-GCM), so that the persisted
`settings` store never contains plaintext secrets written by the application.

#### Scenario: Secret is encrypted on save

- **WHEN** a user saves a media-server token or a provider API key through Settings
- **THEN** the value persisted to the settings store is an encrypted, self-describing string (versioned, e.g. `enc:v1:...`) and not the plaintext secret

#### Scenario: Secret is decrypted transparently on read

- **WHEN** the application resolves runtime configuration that includes an encrypted secret
- **THEN** the secret is decrypted in memory and used normally, with no change to how callers consume configuration

### Requirement: Instance encryption key management

The system SHALL derive its encryption key from an `APP_SECRET` environment variable when present,
and otherwise SHALL auto-generate a key once and persist it privately in the data directory so that
secrets remain decryptable across restarts without any user setup.

#### Scenario: Key derived from APP_SECRET

- **WHEN** `APP_SECRET` is set in the environment
- **THEN** the encryption key is deterministically derived from it so the same secret value decrypts across restarts and deployments sharing that `APP_SECRET`

#### Scenario: Key auto-generated when APP_SECRET absent

- **WHEN** no `APP_SECRET` is configured and no key file yet exists
- **THEN** the system generates a random 32-byte key, persists it with owner-only permissions in the data directory, and reuses it on subsequent boots

### Requirement: Lazy migration of existing plaintext secrets

The system SHALL transparently read pre-existing plaintext secrets and SHALL re-persist them in
encrypted form, so upgrading does not require manual re-entry of credentials.

#### Scenario: Legacy plaintext value still works

- **WHEN** a secret persisted by an older version lacks the encrypted prefix
- **THEN** the system reads it as plaintext and continues to function

#### Scenario: Plaintext upgraded on next save

- **WHEN** settings containing a legacy plaintext secret are next saved
- **THEN** the secret is written back in encrypted form

### Requirement: Safe failure when a secret cannot be decrypted

The system SHALL treat an undecryptable secret (e.g. after a lost or changed key) as unset rather
than crashing, prompting the user to re-authenticate or re-enter the credential.

#### Scenario: Decryption fails

- **WHEN** an encrypted secret cannot be decrypted because the key is missing or changed
- **THEN** the system reports the secret as not set and surfaces a re-login / re-enter prompt instead of erroring out

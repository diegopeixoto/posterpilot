## ADDED Requirements

### Requirement: Consistent application backup bundle

The system SHALL create a self-contained, versioned backup bundle from a consistent SQLite snapshot rather than copying a live database file. The bundle SHALL contain the database state, persisted application settings, PosterPilot-owned configuration files required for that state, the auto-generated encryption-key file when that key mode is in use, and a manifest containing the PosterPilot version, database schema version, creation time, key mode and non-secret key fingerprint, included-file inventory, sizes, and cryptographic checksums. Externally mounted media-server or Kometa content SHALL NOT be copied; its configured paths SHALL be recorded in the manifest. Creating a backup SHALL coordinate with writers so every included component represents one application state.

#### Scenario: Create a backup while the app is active

- **WHEN** the user requests a backup while reads and background work are active
- **THEN** the system obtains a consistent SQLite snapshot, coordinates with mutating work for the brief snapshot boundary, and produces a bundle whose manifest and checksums match its contents

#### Scenario: Auto-generated key is in use

- **WHEN** encrypted settings use the persisted auto-generated key file
- **THEN** the backup includes that key file with owner-only handling and records its fingerprint so restored secrets remain decryptable

#### Scenario: Environment secret is in use

- **WHEN** encrypted settings use `APP_SECRET`
- **THEN** the backup records the environment-derived key mode and a non-reversible fingerprint but never stores `APP_SECRET` or its derived key material

#### Scenario: External files are configured

- **WHEN** the application references a Kometa directory or another path outside PosterPilot's owned data
- **THEN** the manifest records the path and whether it was reachable but the backup does not silently copy that external content

#### Scenario: Snapshot creation fails

- **WHEN** the database snapshot or any required bundle write fails
- **THEN** the system marks backup creation failed, removes the incomplete bundle, resumes paused work, and leaves the running application state unchanged

### Requirement: Backup confidentiality and safe export

The system SHALL treat every backup bundle as secret-bearing data. Locally stored bundles and temporary files SHALL be owner-readable only, backup contents and key material SHALL never be written to logs or activity metadata, and downloading or exporting a bundle SHALL require an explicit user action accompanied by a warning that the bundle may contain credentials and encryption-key material. Backup filenames and manifest fields returned to the UI SHALL contain no secret values.

#### Scenario: Local bundle permissions

- **WHEN** a backup bundle is successfully written to the configured backup directory
- **THEN** the bundle and any included auto-generated key material are accessible only to the application owner according to the host filesystem's supported permission model

#### Scenario: User exports a bundle

- **WHEN** the user explicitly confirms a backup download or export
- **THEN** the system streams the selected validated bundle, shows the secret-bearing warning, and does not expose its server filesystem path or contents in logs

#### Scenario: Backup operation is logged

- **WHEN** backup creation, validation, export, deletion, or restore is recorded in activity history
- **THEN** the event contains only the bundle identifier, timestamps, sizes, status, and redacted diagnostics

### Requirement: Backup inventory and retention policy

The system SHALL list application-managed backups newest first with their creation time, application and schema versions, size, validation status, trigger (manual, scheduled, or pre-restore safety), and retention protection. A configurable retention policy SHALL prune only unprotected application-managed bundles by maximum count and/or age after a new backup succeeds. Manual and pre-restore safety backups SHALL be protected by default, and deleting any protected backup SHALL require explicit confirmation.

#### Scenario: Backups are listed

- **WHEN** the user opens backup management
- **THEN** the system lists every discovered application-managed bundle with its manifest metadata and current validation status without loading secret contents into the browser

#### Scenario: Retention runs after success

- **WHEN** a new backup completes and unprotected bundles exceed the configured count or age policy
- **THEN** the system deletes the oldest policy-eligible bundles and retains protected bundles

#### Scenario: New backup fails

- **WHEN** backup creation fails before a valid bundle exists
- **THEN** the system does not run retention and keeps all prior backups

#### Scenario: Protected backup deletion requested

- **WHEN** the user chooses to delete a manual or pre-restore safety backup
- **THEN** the system identifies the protected bundle and deletes it only after a separate explicit confirmation

### Requirement: Restore validation and readiness preview

Before allowing a restore, the system SHALL validate the bundle format and manifest, every included checksum, SQLite integrity, schema compatibility, required disk space and path writability, and encryption-key compatibility. A backup from an older supported schema SHALL be eligible for normal forward migrations; a backup from a newer unsupported schema SHALL be blocked. For `APP_SECRET` backups, the effective environment secret SHALL match the recorded key fingerprint. Validation SHALL produce a restore preview listing the state that will be replaced, migrations that will run, external paths that require attention, and blocking errors versus non-blocking connectivity warnings, without changing current state.

#### Scenario: Valid compatible backup inspected

- **WHEN** the user selects a valid backup from the same or an older supported schema
- **THEN** the system reports it restorable and shows the replacement scope, key mode, required migrations, and readiness warnings before enabling confirmation

#### Scenario: Checksum or database integrity fails

- **WHEN** an included checksum differs from the manifest or SQLite integrity validation fails
- **THEN** the system blocks restore, identifies the failed validation category, and makes no change to current state

#### Scenario: Backup schema is newer

- **WHEN** the bundle declares a database schema newer than the running PosterPilot version supports
- **THEN** the system blocks restore and tells the user which compatible or newer application version is required

#### Scenario: APP_SECRET does not match

- **WHEN** a backup created in `APP_SECRET` mode is validated under a different or missing `APP_SECRET`
- **THEN** the system blocks restore before replacing files and explains that the original environment secret is required without revealing either fingerprint as key material

#### Scenario: External service is unavailable

- **WHEN** local bundle checks pass but a recorded media-server or provider endpoint cannot be reached
- **THEN** the preview reports a non-blocking external-readiness warning and does not misclassify the backup as corrupt

### Requirement: Confirmed transactional restore

Restoring a backup SHALL require explicit confirmation bound to the validated bundle checksum and preview. The system SHALL enter maintenance mode, stop accepting new mutating jobs, let in-flight mutations reach a safe terminal point, create a protected safety backup of current state, and replace the database, included configuration, and included key file as one recoverable operation. It SHALL then run supported forward migrations and local readiness checks. If replacement, migration, or readiness fails, the system SHALL automatically restore the safety backup and report the failure; it SHALL never continue serving a partially restored state.

#### Scenario: Restore succeeds

- **WHEN** the user confirms an unchanged valid preview and replacement, migrations, and local readiness checks all succeed
- **THEN** the restored state becomes active, maintenance mode ends, and the system records a successful restore linked to the protected safety backup

#### Scenario: Bundle changes after preview

- **WHEN** the selected bundle's checksum no longer matches the checksum bound to the confirmation
- **THEN** the system rejects the confirmation and requires a new validation preview

#### Scenario: Mutating work is in flight

- **WHEN** a restore is confirmed while a sync or apply mutation is running
- **THEN** the system prevents new mutations, waits for or safely terminates the in-flight mutation according to its job contract, and does not replace state until the mutation is terminal

#### Scenario: Restore fails after replacement begins

- **WHEN** file replacement, schema migration, decryption verification, or another local readiness check fails
- **THEN** the system rolls back all replaced components from the safety backup, remains or returns to the prior ready state, and reports the failed stage

### Requirement: Post-restore verification and recovery guidance

After a successful restore the system SHALL verify database integrity, schema readiness, decryption of stored secret values, configured writable paths, and server-instance namespacing before resuming background jobs. It SHALL show a restore report that distinguishes locally ready components from external integrations needing reconnection or path repair. Scheduled automation SHALL remain paused when a blocking readiness check fails and SHALL resume only after the restored configuration is locally ready.

#### Scenario: All readiness checks pass

- **WHEN** a restored database, key, configuration, paths, and server scopes pass their local checks
- **THEN** the system reports the restore ready and resumes normal job acceptance and previously enabled schedules

#### Scenario: Stored secret cannot be decrypted

- **WHEN** post-restore verification cannot decrypt an encrypted persisted credential
- **THEN** the restore is treated as locally unready, automatic work remains paused, and the report identifies the affected setting without showing its value

#### Scenario: Writable path changed on the new host

- **WHEN** a restored Kometa or backup destination is missing or not writable
- **THEN** the report identifies that path as requiring repair, keeps operations depending on it disabled, and allows unrelated locally ready features to remain available

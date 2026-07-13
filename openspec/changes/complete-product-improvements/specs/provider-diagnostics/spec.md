## ADDED Requirements

### Requirement: Run non-mutating component diagnostics

The system SHALL run independent, time-bounded diagnostic checks for each configured media server, TMDB, each artwork provider, the Kometa configuration and assets paths, the application data path, and any configured backup path. Diagnostic checks SHALL validate only connectivity, credentials, capability discovery, and filesystem access and SHALL NOT apply artwork, modify media metadata, write Kometa configuration, or change persisted settings.

#### Scenario: One component is unreachable

- **WHEN** a diagnostic run cannot reach one configured component
- **THEN** the system records that component's failure and continues checking the remaining components

#### Scenario: Diagnostic run is non-mutating

- **WHEN** the user starts a complete diagnostic run
- **THEN** the system performs no artwork apply, metadata update, Kometa configuration write, or settings mutation

#### Scenario: Check exceeds its deadline

- **WHEN** a component does not respond within its diagnostic timeout
- **THEN** the system records a timed-out result for that component and completes the rest of the run

### Requirement: Report structured health and credential status

Each diagnostic result SHALL include the component identifier and type, health state, credential state when credentials are applicable, observed latency, checked-at time, last-success time, and a sanitized error category and message when unsuccessful. Health and credential states SHALL distinguish at least healthy, degraded, unavailable, disabled, missing credential, rejected credential, and unknown conditions without revealing credential values.

#### Scenario: Healthy component responds

- **WHEN** a component diagnostic succeeds
- **THEN** the result reports healthy status, measured latency, checked-at time, and an updated last-success time

#### Scenario: Credential is missing

- **WHEN** an enabled component requires a credential that is not configured
- **THEN** the result reports missing credential without attempting an authenticated content operation or exposing any credential field value

#### Scenario: Credential is rejected

- **WHEN** a remote service rejects the configured credential
- **THEN** the result reports rejected credential separately from network unavailability and sanitizes the remote error

#### Scenario: Provider serves stale candidates after an outage

- **WHEN** an artwork provider is unavailable while last-known-good candidates remain usable
- **THEN** the result reports degraded health, the current error, and the provider's prior last-success time

### Requirement: Persist diagnostic history safely

The system SHALL persist the latest result and a bounded history of diagnostic runs for every component so status survives process restarts. Persisted results SHALL contain sanitized observations only and SHALL never contain access tokens, API keys, authorization headers, passwords, session identifiers, or unredacted credential-bearing URLs.

#### Scenario: Application restarts after a diagnostic run

- **WHEN** the application starts with prior diagnostic history
- **THEN** the system exposes the latest sanitized result and last-success time for each component before a new run is requested

#### Scenario: History reaches its retention bound

- **WHEN** recording a diagnostic result would exceed the configured history retention
- **THEN** the system removes the oldest result for that component while retaining its latest result and last-success value

### Requirement: Validate filesystem readiness

The system SHALL report existence, expected object type, readability, and writability for each configured local path according to the operations that use it. A writability test SHALL use a disposable probe in the target directory and SHALL clean up that probe; it SHALL NOT overwrite an existing user file.

#### Scenario: Kometa path is writable

- **WHEN** the configured Kometa assets directory exists and permits the required reads and writes
- **THEN** the diagnostic reports the path ready and removes its disposable probe

#### Scenario: Path is read-only

- **WHEN** a configured path is readable but not writable for an operation that requires writes
- **THEN** the diagnostic reports the path degraded with a writable-path failure and leaves existing files unchanged

#### Scenario: Path has the wrong type

- **WHEN** a configured directory path points to a regular file or a required file path points to a directory
- **THEN** the diagnostic reports the type mismatch with a corrective hint

### Requirement: Expose media-server capabilities

The system SHALL include each media server instance's advertised or verified artwork capabilities in diagnostics, including poster, background, season, and episode write support; field locking; current-image retrieval; and any limitations needed for preview, verification, or undo. Unsupported capabilities SHALL be reported explicitly rather than inferred from server type alone.

#### Scenario: Server lacks an artwork capability

- **WHEN** a connected server cannot perform one of the normalized artwork operations
- **THEN** diagnostics mark that operation unsupported and identify which workflows are unavailable for that server instance

#### Scenario: Capabilities are verified

- **WHEN** a media-server connection check succeeds
- **THEN** the diagnostic result includes the capability set reported or safely verified for that concrete server instance

### Requirement: Export a redacted support bundle

The system SHALL generate a support bundle only after an explicit user export action. The bundle SHALL contain application version and runtime information, configuration shape with secrets replaced by redaction markers, schema and migration state, recent sanitized jobs and diagnostic results, provider outcome summaries, and relevant sanitized logs. The bundle SHALL include a manifest describing its contents and SHALL exclude the media database contents, artwork files, raw provider responses, credentials, and personal media titles unless the user explicitly opts into title inclusion.

#### Scenario: Default support bundle is exported

- **WHEN** the user explicitly requests a support bundle without opting into media titles
- **THEN** the system exports the documented diagnostic files and manifest with all secrets and media titles omitted or redacted

#### Scenario: Sensitive value resembles a credential

- **WHEN** a configured secret appears in a URL, header, error message, job payload, or log selected for export
- **THEN** the system replaces the full sensitive value before adding that content to the bundle

#### Scenario: Bundle generation cannot sanitize an entry

- **WHEN** the exporter cannot prove that an optional entry is safe to include
- **THEN** the system omits that entry, records the omission in the manifest, and still produces the remaining bundle

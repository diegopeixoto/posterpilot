## ADDED Requirements

### Requirement: Manage multiple named server instances

The system SHALL let the user create and manage multiple Plex, Jellyfin, and Emby server instances simultaneously. Each instance SHALL have an immutable internal identifier, a user-visible name unique within the installation, server type, base URL, encrypted type-appropriate credential, enabled state, connection-test status, and timestamps. Creating or changing connection details SHALL use the corresponding provider's authentication and connection-test behavior; a failed test SHALL be reported against that instance and SHALL NOT alter credentials for any other instance.

#### Scenario: Add a second server

- **WHEN** the user saves valid tested connection details under a new unique name
- **THEN** the system creates a new enabled server instance with its own identifier and credential while leaving existing instances unchanged

#### Scenario: Add a different provider type

- **WHEN** an installation already containing Plex adds a tested Jellyfin or Emby connection
- **THEN** the system stores the new server under its selected type and uses that provider's credential format without changing the Plex configuration

#### Scenario: Server name is duplicated

- **WHEN** the user attempts to save a server name that equals another instance name under normalized case and whitespace rules
- **THEN** the system rejects the name with a localized validation error and does not create or overwrite an instance

#### Scenario: Updated credentials fail testing

- **WHEN** the user enters replacement connection details that fail authentication or connectivity testing
- **THEN** the system reports the structured failure and retains the previously working stored credentials unless the user explicitly saves the instance disabled

#### Scenario: Secret is read back

- **WHEN** a server-management or public-configuration response describes a saved instance
- **THEN** it indicates whether a credential is set but never returns the credential's stored or decrypted value

### Requirement: Migrate existing single-server installations in place

On first startup with the multi-server schema, the system SHALL create exactly one default named server instance from the existing active server type, URL, and encrypted credential and SHALL associate all existing server-owned data with that instance in one transactional, idempotent migration. Existing library items, matches, candidates, selections, revisions, jobs, ignores, and history SHALL remain usable without a destructive resync. A fresh installation with no prior server configuration SHALL create no placeholder connection and SHALL continue through setup.

#### Scenario: Existing configured installation migrates

- **WHEN** the migration runs on a single-server database with configured Plex, Jellyfin, or Emby credentials
- **THEN** it creates one default instance for that provider and assigns every existing server-owned record to its identifier while preserving record identities and behavior

#### Scenario: Migration is retried

- **WHEN** startup runs again after the multi-server migration has already completed
- **THEN** the migration creates no duplicate instance and changes no established server associations

#### Scenario: Migration cannot assign a record

- **WHEN** an existing server-owned record cannot be safely associated with the migrated instance
- **THEN** the transaction fails with an actionable migration error and the pre-migration database remains intact

#### Scenario: Fresh unconfigured installation starts

- **WHEN** the new schema is initialized without existing media-server configuration
- **THEN** no fake server instance is created and setup prompts the user to add the first server

### Requirement: Strict server-scoped data isolation

Every library, item, external identifier, resolution, candidate, selection, ignored state, artwork snapshot and revision, collection membership, review state, provider outcome, job, schedule, and activity record that belongs to a media server SHALL carry its immutable server-instance identifier. Uniqueness and lookup rules SHALL use that scope so identical provider item or library identifiers on different servers do not collide. Server-facing APIs and background operations SHALL validate that every referenced entity belongs to the requested server and SHALL refuse mixed-scope payloads before mutation.

#### Scenario: Provider identifiers collide

- **WHEN** two servers return the same library key or item identifier
- **THEN** the system stores and retrieves two distinct records using their server-instance scopes

#### Scenario: Item is requested in the wrong scope

- **WHEN** a request names server A but references an item belonging to server B
- **THEN** the system returns a not-found or scope-validation response without revealing server B's item or performing any operation

#### Scenario: Mixed-server apply payload is submitted

- **WHEN** a normal single-server apply request contains selections from more than one server scope
- **THEN** the system rejects the complete request before writing any server or Kometa state and directs the caller to the explicit cross-server flow

#### Scenario: One server is resynced

- **WHEN** the user synchronizes server A
- **THEN** additions, updates, removals, and current-art refreshes are limited to server A and no cached state for server B changes

### Requirement: Explicit active-server context

The application shell SHALL show the currently selected named server and provide a server switcher whenever at least two enabled instances exist. Library, dashboard, review, item, collection, activity, Fun, settings subsections, and mutation routes SHALL preserve or explicitly change that server context. A read-only all-servers dashboard MAY aggregate counts but SHALL label each result by server and SHALL require selecting a concrete server before any mutation. With exactly one enabled instance, the UI SHALL use it transparently while still retaining its scope in URLs or server-side state.

#### Scenario: Switch active server

- **WHEN** the user chooses another enabled instance in the server switcher
- **THEN** server-scoped pages reload for that instance, their URLs or navigation state preserve the selection, and filters from the prior server are not applied when invalid for the new one

#### Scenario: Open an item link with a server scope

- **WHEN** the user follows a saved link containing a valid server and item identifier
- **THEN** the shell selects that server and renders the item from the same scope even if another server was selected previously

#### Scenario: Use a single-server installation

- **WHEN** exactly one enabled server instance exists
- **THEN** existing navigation behaves as a one-server installation without requiring a switcher interaction and all requests still resolve that instance explicitly on the server

#### Scenario: Mutate from an all-servers summary

- **WHEN** the user starts an apply, sync, review, or configuration mutation from an aggregate view
- **THEN** the system requires a concrete destination server and shows it in confirmation before enabling the mutation

### Requirement: Server-bound jobs and safe concurrency

Every server-related job payload, persisted attempt, result, retry, progress event, and deduplication key SHALL include the target server-instance identifier. A worker SHALL construct credentials and providers from that identifier at execution time and SHALL fail safely when the instance is disabled or changed incompatibly. Incompatible duplicate work SHALL be prevented per server and scope, while independent work for different servers MAY run concurrently within global concurrency limits.

#### Scenario: Same library sync is requested twice

- **WHEN** two active sync requests target the same library on the same server
- **THEN** the job system reuses or rejects the incompatible duplicate according to the job contract rather than running both

#### Scenario: Different servers sync concurrently

- **WHEN** syncs are requested for server A and server B and capacity is available
- **THEN** each job resolves only its own instance credentials and the jobs may progress concurrently without sharing results

#### Scenario: Server is disabled before a queued job starts

- **WHEN** a queued server job reaches execution after its target instance was disabled
- **THEN** the attempt ends with a structured server-disabled result and performs no operation against another or default server

#### Scenario: Job progress is viewed

- **WHEN** the dashboard or activity view renders a server-related job
- **THEN** the job is labeled with its named server and progress events cannot be attached to a same-typed job from another server

### Requirement: Provider capabilities remain instance-specific

The system SHALL resolve supported operations from each server instance's provider and version rather than from a global active type. UI controls, plans, diagnostics, Kometa availability, child-artwork support, and collection-artwork support SHALL reflect the concrete target instance. Plex-only Kometa operations SHALL require an explicitly associated Plex server and SHALL never borrow Plex credentials from another named instance implicitly.

#### Scenario: Two servers have different capabilities

- **WHEN** one selected instance supports an artwork slot or operation that another does not
- **THEN** each instance's UI and preview enables or disables that operation according to its own capability result

#### Scenario: Kometa is used with multiple Plex servers

- **WHEN** the user configures a Kometa target in a multi-server installation
- **THEN** the system binds that target to a named Plex instance and shows the binding in every preview and confirmation

#### Scenario: Non-Plex server is selected for Kometa

- **WHEN** the user attempts to bind a Jellyfin or Emby instance to a Plex-only Kometa connection
- **THEN** the system rejects the binding with an explicit capability explanation and does not fall back to another server's Plex credentials

### Requirement: Explicit cross-server artwork application

The system SHALL offer an optional cross-server application flow only after matching source and destination items by a verified shared TMDB identifier or another exact external identifier. The user SHALL explicitly select destination server instances, items, artwork slots, and targets. Before writing, the system SHALL produce one immutable preview per destination showing the current snapshot, candidate provenance or source bytes, capability decisions, and planned operation. Confirmation SHALL be bound to all previews, and each destination SHALL create and verify its own revision. Cross-server application SHALL never be the default consequence of applying on one server and SHALL never match by title alone.

#### Scenario: Exact match exists on another server

- **WHEN** the user chooses cross-server application and a destination item has the same verified TMDB identifier as the source
- **THEN** the system offers that item as a destination and includes its named server and current artwork in the preview

#### Scenario: Only the title matches

- **WHEN** an item on another server has a similar title but no exact shared external identifier
- **THEN** the system does not select or apply to that item automatically

#### Scenario: Confirm cross-server plan

- **WHEN** the user confirms an unchanged plan containing multiple destinations
- **THEN** the system performs only those destination operations, records isolated revisions under each server, verifies each supported write, and reports results per destination

#### Scenario: One destination is unavailable

- **WHEN** a destination server becomes unavailable after preview
- **THEN** that destination records a failure while independent confirmed destinations may complete, and no operation is redirected to another server

### Requirement: Disable, disconnect, and purge a server safely

The system SHALL let the user disable a server without deleting its cached data or history. Disconnecting SHALL require confirmation, stop new server jobs and schedules, remove stored credentials, and retain scoped records as disconnected history. Permanent purge SHALL be a separate destructive action with a preview of affected libraries, items, jobs, revisions, collections, and schedules and an additional explicit confirmation; it SHALL be blocked while mutating jobs for that server are active. Neither action SHALL affect other instances.

#### Scenario: Disable a server

- **WHEN** the user disables a named instance
- **THEN** its cached library and history remain viewable, new automated or manual server mutations are blocked, and other instances continue normally

#### Scenario: Disconnect a server

- **WHEN** the user confirms disconnect for an inactive instance
- **THEN** the system removes that instance's credential and disables its schedules while preserving server-scoped historical data

#### Scenario: Preview permanent purge

- **WHEN** the user requests permanent deletion of a disconnected instance
- **THEN** the system shows exact scoped record counts and backup guidance and performs no deletion until the separate purge confirmation

#### Scenario: Purge is confirmed

- **WHEN** no mutating job for the instance is active and the user confirms the unchanged purge preview
- **THEN** the system removes only that instance and its scoped data, leaves all other instances intact, and records a redacted audit event

#### Scenario: Last server is purged

- **WHEN** the final configured server instance is permanently purged
- **THEN** the application returns to the add-server setup state without deleting global configuration, application backups, or documentation settings

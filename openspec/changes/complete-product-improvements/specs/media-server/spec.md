## ADDED Requirements

### Requirement: Authenticate to Jellyfin or Emby with username and password

The system SHALL let the user authenticate to a Jellyfin or Emby server during setup using the server base URL, username, and password, and SHALL exchange those credentials through the provider's authentication endpoint for a reusable access token or API key. The system SHALL test the acquired credential, persist the reusable credential using the configured secret-protection mechanism, and SHALL NOT persist or log the submitted password.

#### Scenario: Jellyfin login succeeds

- **WHEN** the user submits a reachable Jellyfin URL and valid username and password
- **THEN** the Jellyfin provider obtains an access token, verifies it, persists the protected reusable credential for the server instance, and discards the password

#### Scenario: Emby login succeeds

- **WHEN** the user submits a reachable Emby URL and valid username and password
- **THEN** the Emby provider obtains an access token, verifies it, persists the protected reusable credential for the server instance, and discards the password

#### Scenario: Username or password is rejected

- **WHEN** Jellyfin or Emby rejects the submitted username or password
- **THEN** the system reports an inline unauthorized result, persists neither password nor unusable access token, and does not advance setup

#### Scenario: Login cannot reach the server

- **WHEN** the submitted Jellyfin or Emby URL is unreachable
- **THEN** the system reports the connection failure separately from rejected credentials and does not persist the password

### Requirement: Offer provider-appropriate setup authentication

The setup flow SHALL derive available authentication methods from the selected server type: Plex PIN login and optional existing token for Plex, and username/password login or an existing API key/access token for Jellyfin and Emby. A successful authentication result SHALL populate the same concrete server-instance credential model used by settings and later connection tests.

#### Scenario: Plex is selected in setup

- **WHEN** the user chooses Plex as the server type
- **THEN** setup offers Plex PIN login and existing-token entry without showing Jellyfin or Emby credential fields

#### Scenario: Jellyfin or Emby is selected in setup

- **WHEN** the user chooses Jellyfin or Emby as the server type
- **THEN** setup offers username/password login and existing reusable-credential entry without showing Plex PIN controls

#### Scenario: Authentication is reused by connection testing

- **WHEN** any provider-appropriate setup authentication succeeds
- **THEN** the resulting protected reusable credential is associated with the concrete server instance and used by the standard provider connection test

### Requirement: Report normalized media-server capabilities

Each media-server provider SHALL report a normalized capability set for its concrete server instance, including support for reading and writing posters and backgrounds, season artwork, episode artwork, field locking, current-image retrieval, and any provider limitation relevant to preview, verification, or undo. Capabilities SHALL be returned with connection diagnostics and SHALL be consulted before an operation is planned.

#### Scenario: Supported operation is planned

- **WHEN** a server instance reports support for every operation required by an artwork plan
- **THEN** the system permits that plan to proceed through preview and confirmation

#### Scenario: Unsupported operation is requested

- **WHEN** an artwork plan requires a capability that the concrete server instance reports as unsupported
- **THEN** the system excludes or blocks that operation before mutation and identifies the unsupported capability

#### Scenario: Capability set is unavailable

- **WHEN** a connection succeeds but the provider cannot determine an optional capability
- **THEN** the provider reports that capability as unknown rather than assuming support

## MODIFIED Requirements

### Requirement: Media server provider interface

The system SHALL define a single `MediaServer` provider interface that all media-server integrations implement, exposing: authenticate by a provider-supported method; test the connection; report normalized capabilities; list libraries/sections (filtered to movie and show types); list items in a library (each with its concrete server-instance identifier, source identifier, title, year, type, external GUIDs, and current poster/art URLs); upload a poster from an image URL; upload a poster from raw image bytes; set a background/art image; and lock a field so the server's automatic agents do not overwrite an applied image. Every operation SHALL be bound to a concrete server instance. The rest of the application (sync, discover, apply, diagnostics) SHALL depend only on this interface and SHALL NOT call any provider's HTTP API directly.

#### Scenario: Application uses the instance provider

- **WHEN** the application performs any server operation (authentication, connection test, capability lookup, list libraries, list items, apply poster/background, or lock field)
- **THEN** it resolves the provider for the specified server instance and invokes the operation through the `MediaServer` interface, with no provider-specific code in the calling layer

#### Scenario: Providers are interchangeable

- **WHEN** a new provider implementing the `MediaServer` interface is supplied for a server type
- **THEN** the existing sync, discover, apply, and diagnostics flows operate against it without changes to those flows

#### Scenario: Operation lacks a server instance

- **WHEN** a server operation is requested without a concrete server-instance identifier
- **THEN** the system refuses the operation rather than falling back to a global active server

### Requirement: Provider factory selects by server type

The system SHALL select a provider from the server type of the concrete server instance — one of `plex`, `jellyfin`, or `emby` — and SHALL construct it with that instance's base URL and protected reusable credential (Plex token, or Jellyfin/Emby API key or access token). When the server type is unknown, the instance does not exist, or the instance's required connection data is missing, the system SHALL refuse to construct the provider and report which configuration is missing.

#### Scenario: Plex instance selected

- **WHEN** the specified server instance has type `plex` and a Plex URL and token are configured
- **THEN** the factory returns the Plex provider bound to that instance identifier, URL, and token

#### Scenario: Jellyfin or Emby instance selected

- **WHEN** the specified server instance has type `jellyfin` or `emby` and that instance's base URL and reusable credential are configured
- **THEN** the factory returns the corresponding provider bound to that instance identifier, base URL, and credential

#### Scenario: Selected instance not configured

- **WHEN** the specified server instance is absent or its required connection data is missing
- **THEN** the factory refuses to construct a provider and reports the missing instance or fields rather than using credentials from another server

#### Scenario: Unknown server type

- **WHEN** the specified server instance has an unsupported server type
- **THEN** the factory refuses to construct a provider and reports the unsupported type

### Requirement: Test a provider connection

Each provider SHALL verify connectivity and credentials before any library operation, returning a structured result that distinguishes success (with concrete server-instance identifier, server name, version, and normalized capabilities when available) from failure, and within failure distinguishes a rejected credential (unauthorized) from an unreachable server (network error). A connection test SHALL never throw — failures are returned as a sanitized result associated with the tested instance.

#### Scenario: Valid credentials

- **WHEN** the specified provider instance's base URL and credential are valid and the user triggers a connection test
- **THEN** the provider queries the server's identity/system endpoint and reports success with the instance identifier, server name, version, and available capability set

#### Scenario: Rejected credential

- **WHEN** the credential (Plex token or Jellyfin/Emby API key or access token) is rejected
- **THEN** the provider reports a connection failure flagged as unauthorized for that server instance and does not proceed with library operations

#### Scenario: Unreachable server

- **WHEN** the server instance's base URL is unreachable (network/DNS error)
- **THEN** the provider reports a connection failure flagged as unreachable, with a sanitized underlying reason, and does not proceed

#### Scenario: Connection succeeds with unknown capability

- **WHEN** the server identity endpoint succeeds but an optional capability cannot be determined
- **THEN** the result remains a successful connection and reports that capability as unknown

### Requirement: List libraries and items through a provider

Each provider SHALL list the specified server instance's movie and show libraries (excluding non-media libraries), and for a chosen library SHALL list its items, returning for each library and item the concrete server-instance identifier. Each item SHALL also include its source identifier, a globally unambiguous composite identity, title, year, type (movie/show), the set of external GUIDs (tmdb/imdb/tvdb when present), the URL of its current poster (and current background/art when available), a watched flag, and the date the item was added to the server. The watched flag SHALL be true for a movie the server account has played at least once (Plex `viewCount > 0`, Jellyfin/Emby `UserData.Played`) and for a show whose episodes are all played (Plex `viewedLeafCount >= leafCount`, Jellyfin/Emby `UserData.Played`); when the server omits watched data the flag SHALL be false. The date added SHALL be mapped from Plex `addedAt` and Jellyfin/Emby `DateCreated`, and SHALL be null when the server omits it or the value is invalid. An item lacking any external GUID SHALL still be returned and flagged as unresolvable rather than omitted.

#### Scenario: Libraries enumerated

- **WHEN** a connection is established and the user requests libraries for a server instance
- **THEN** the provider returns each movie and show library with its server-instance identifier, source key/id, title, and type, excluding music, photos, and other non-media libraries

#### Scenario: Items returned with metadata

- **WHEN** the user opens a library belonging to a server instance
- **THEN** the provider returns the library's items, each with that server-instance identifier, source id, composite identity, title, year, type, external GUIDs, watched flag, date added, and current poster URL (and current background URL when the server exposes one)

#### Scenario: Source identifiers collide across servers

- **WHEN** two server instances return the same source library or item identifier
- **THEN** the system keeps them distinct by their server-instance identifiers and composite identities

#### Scenario: Item missing external GUIDs

- **WHEN** an item has no tmdb/imdb/tvdb GUID
- **THEN** the provider still returns the item for its server instance and flags it unresolvable for artwork lookup rather than dropping it

#### Scenario: Watched flag mapped per server type

- **WHEN** items are listed from Plex, Jellyfin, or Emby
- **THEN** each item's watched flag reflects that server's played state (movie played at least once; show fully played), and items without watched data report false

#### Scenario: Date added mapped per server type

- **WHEN** items are listed from Plex, Jellyfin, or Emby
- **THEN** each item carries its server date-added (Plex `addedAt`, Jellyfin/Emby `DateCreated`), and items with missing or invalid values report null

# media-server Specification

## Purpose
TBD - created by archiving change multi-server-support. Update Purpose after archive.
## Requirements
### Requirement: Media server provider interface

The system SHALL define a single `MediaServer` provider interface that all media-server integrations implement, exposing: test the connection, list libraries/sections (filtered to movie and show types), list items in a library (each with its identifier, title, year, type, external GUIDs, and current poster/art URLs), upload a poster from an image URL, upload a poster from raw image bytes, set a background/art image, and lock a field so the server's automatic agents do not overwrite an applied image. The rest of the application (sync, discover, apply) SHALL depend only on this interface and SHALL NOT call any provider's HTTP API directly.

#### Scenario: Application uses the active provider

- **WHEN** the application performs any server operation (connection test, list libraries, list items, apply poster/background, lock field)
- **THEN** it resolves the active provider for the configured server type and invokes the operation through the `MediaServer` interface, with no provider-specific code in the calling layer

#### Scenario: Providers are interchangeable

- **WHEN** a new provider implementing the `MediaServer` interface is supplied for a server type
- **THEN** the existing sync, discover, and apply flows operate against it without changes to those flows

### Requirement: Provider factory selects by server type

The system SHALL select the active provider from the configured server type — one of `plex`, `jellyfin`, or `emby` — and SHALL construct it with that provider's credentials (Plex: base URL + token; Jellyfin/Emby: base URL + API key). When the server type is unknown or the active provider's credentials are missing, the system SHALL refuse to construct the provider and report which configuration is missing.

#### Scenario: Plex selected

- **WHEN** the server type is `plex` and a Plex URL and token are configured
- **THEN** the factory returns the Plex provider bound to that URL and token

#### Scenario: Jellyfin or Emby selected

- **WHEN** the server type is `jellyfin` or `emby` and that provider's base URL and API key are configured
- **THEN** the factory returns the corresponding provider bound to its base URL and API key

#### Scenario: Active provider not configured

- **WHEN** the active server type's credentials are absent
- **THEN** the factory refuses to construct a provider and reports which credentials are missing rather than producing a half-configured client

### Requirement: Test a provider connection

Each provider SHALL verify connectivity and credentials before any library operation, returning a structured result that distinguishes success (with server name and version when available) from failure, and within failure distinguishes a rejected credential (unauthorized) from an unreachable server (network error). A connection test SHALL never throw — failures are returned as a result.

#### Scenario: Valid credentials

- **WHEN** the active provider's base URL and credential are valid and the user triggers a connection test
- **THEN** the provider queries the server's identity/system endpoint and reports success with the server name and version

#### Scenario: Rejected credential

- **WHEN** the credential (Plex token or Jellyfin/Emby API key) is rejected
- **THEN** the provider reports a connection failure flagged as unauthorized and does not proceed with library operations

#### Scenario: Unreachable server

- **WHEN** the base URL is unreachable (network/DNS error)
- **THEN** the provider reports a connection failure flagged as unreachable, with the underlying reason, and does not proceed

### Requirement: List libraries and items through a provider

Each provider SHALL list the server's movie and show libraries (excluding non-media libraries), and for a chosen library SHALL list its items, returning for each item a stable identifier, title, year, type (movie/show), the set of external GUIDs (tmdb/imdb/tvdb when present), and the URL of its current poster (and current background/art when available). An item lacking any external GUID SHALL still be returned and flagged as unresolvable rather than omitted.

#### Scenario: Libraries enumerated

- **WHEN** a connection is established and the user requests libraries
- **THEN** the provider returns each movie and show library with its key/id, title, and type, excluding music, photos, and other non-media libraries

#### Scenario: Items returned with metadata

- **WHEN** the user opens a library
- **THEN** the provider returns the library's items, each with a stable id, title, year, type, external GUIDs, and current poster URL (and current background URL when the server exposes one)

#### Scenario: Item missing external GUIDs

- **WHEN** an item has no tmdb/imdb/tvdb GUID
- **THEN** the provider still returns the item and flags it unresolvable for MediaUX lookup rather than dropping it

### Requirement: Apply poster and background through a provider

Each provider SHALL set an item's poster from an image URL or from raw image bytes, SHALL set an item's background/art image, and SHALL lock the corresponding field so the server's automatic agents do not overwrite it. When the server rejects an upload, the provider SHALL report the failure with the server's status and SHALL NOT lock the field. Plex applies artwork by URL and bytes and locks via `thumb.locked`/`art.locked`; Jellyfin and Emby upload artwork bytes to `POST /Items/{id}/Images/{type}` (e.g. `Primary` for poster, `Backdrop` for background).

#### Scenario: Poster applied and locked

- **WHEN** the system applies a poster (by URL or bytes) to an item via the active provider
- **THEN** the provider sets the image as the item's selected poster, locks the poster field, and reports success

#### Scenario: Background applied and locked

- **WHEN** the system applies a background/art image to an item via the active provider
- **THEN** the provider sets the image as the item's background/art, locks that field, and reports success

#### Scenario: Server rejects the upload

- **WHEN** the media server returns an error while setting an image
- **THEN** the provider reports the failure with the server's status and does not lock the field

### Requirement: Plex token-acquire PIN login

The system SHALL provide a PIN-based Plex login that acquires an `X-Plex-Token` via plex.tv without the user manually pasting a token. It SHALL create a PIN with `POST https://plex.tv/api/v2/pins?strong=true` (sending a stable client identifier and product headers), present the returned code and the plex.tv link/auth URL to the user, then poll the pin id (`GET https://plex.tv/api/v2/pins/{id}`) until an `authToken` appears. On success it SHALL store the acquired token as the Plex credential; on expiry it SHALL stop polling and report that the PIN expired.

#### Scenario: PIN created and shown

- **WHEN** the user starts a Plex login
- **THEN** the system creates a strong PIN via plex.tv, persists the returned pin id and client identifier, and shows the user the code and the plex.tv authorization link

#### Scenario: Token acquired by polling

- **WHEN** the user authorizes the code on plex.tv and the system polls the pin id
- **THEN** the system receives the `authToken`, stores it as the Plex token, and reports the login as successful

#### Scenario: PIN expires before authorization

- **WHEN** the PIN's expiry passes without an `authToken` being returned
- **THEN** the system stops polling and reports that the PIN expired, inviting the user to start a new login

### Requirement: Plex connection discovery with local/remote selection

After a Plex token is available, the system SHALL discover the user's servers and their connections via `GET https://plex.tv/api/v2/resources?includeHttps=1`, returning for each server its name and each connection's URI/address, whether it is `local`, and whether it is a relay. The user SHALL be able to pick a discovered local or remote connection URL to use as the Plex base URL instead of typing one. The system SHOULD verify a chosen connection with a connection test before saving it.

#### Scenario: Servers and connections listed

- **WHEN** a Plex token is available and the user requests connection discovery
- **THEN** the system lists each Plex server the user owns/has access to, with every connection labeled local or remote (and relay flagged) and its URI shown for selection

#### Scenario: Local connection selected

- **WHEN** the user picks a discovered local connection
- **THEN** the system sets the Plex base URL to that connection's URI and (after a successful connection test) saves it as the active Plex URL

#### Scenario: Remote connection selected

- **WHEN** no local connection is reachable and the user picks a remote (or relay) connection
- **THEN** the system sets the Plex base URL to that remote connection's URI and saves it after a successful connection test

#### Scenario: Discovery without a token

- **WHEN** connection discovery is requested but no Plex token is available
- **THEN** the system reports that a Plex login is required first and does not call the resources endpoint


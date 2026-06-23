# plex-integration Specification

## Purpose

TBD - created by archiving change add-poster-manager. Update Purpose after archive.
## Requirements
### Requirement: Connect to a Plex server

The system SHALL connect to a Plex Media Server using a base URL and an `X-Plex-Token`, and SHALL verify connectivity before performing library operations. The Plex integration SHALL be implemented as one provider behind the `media-server` interface, so it is selected only when the active server type is `plex`.

#### Scenario: Valid credentials

- **WHEN** a base URL and a valid token are configured and the user triggers a connection test
- **THEN** the system queries the Plex server identity endpoint and reports a successful connection with the server name and version

#### Scenario: Invalid or unreachable server

- **WHEN** the URL is unreachable or the token is rejected
- **THEN** the system reports a connection failure with the reason (network error vs. 401 unauthorized) and does not proceed with library operations

#### Scenario: Plex provider selected by server type

- **WHEN** the active server type is `plex`
- **THEN** the media-server provider factory returns the Plex provider bound to the configured Plex URL and token, and all server operations route through it

### Requirement: List library sections

The system SHALL list the Plex library sections, filtered to movie and show section types.

#### Scenario: Sections enumerated

- **WHEN** a connection is established and the user requests sections
- **THEN** the system returns each movie and show section with its key, title, and type, and excludes non-media sections (e.g., music, photos)

### Requirement: List items in a section

The system SHALL list the items of a section, returning for each item its rating key, title, year, type, GUIDs, and the URL of its current poster (thumb).

#### Scenario: Items returned with metadata

- **WHEN** the user opens a section
- **THEN** the system returns the section's items each with rating key, title, year, type, the set of external GUIDs (tmdb/imdb/tvdb when present), and a current-poster URL resolved against the Plex server and token

#### Scenario: Item missing external GUIDs

- **WHEN** an item has no tmdb/imdb/tvdb GUID
- **THEN** the system still returns the item and flags it as unresolvable for MediaUX lookup rather than omitting it

### Requirement: Apply a poster via the Plex API

The system SHALL set an item's poster by supplying an image URL (or raw image bytes) to the Plex `posters` endpoint, and SHALL lock the poster field (`thumb.locked`) so Plex's automatic agents do not overwrite it. The Plex provider SHALL implement the `media-server` apply contract, and SHALL also set a background/art image and lock it (`art.locked`).

#### Scenario: Poster applied and locked

- **WHEN** the system applies a candidate poster URL to an item's rating key
- **THEN** the Plex server fetches and sets the image as the selected poster, the system locks the poster field, and the operation reports success

#### Scenario: Plex rejects the upload

- **WHEN** the Plex server returns an error while setting the poster (e.g., the image URL is unreachable from Plex)
- **THEN** the system reports the failure with the Plex status and does not lock the field

#### Scenario: Background applied and locked

- **WHEN** the system applies a background/art image to an item via the Plex provider
- **THEN** the Plex server sets the image as the item's art, the system locks the art field, and the operation reports success

### Requirement: Acquire a Plex token via PIN login

The system SHALL let a user acquire an `X-Plex-Token` through a plex.tv PIN login instead of manually pasting a token. It SHALL create a strong PIN (`POST https://plex.tv/api/v2/pins?strong=true`) with a stable client identifier and product headers, show the user the PIN code and the plex.tv authorization link, poll the pin id until plex.tv returns an `authToken`, and then store that token as the Plex credential. Polling SHALL stop at the PIN's expiry.

#### Scenario: User logs in and a token is stored

- **WHEN** the user starts a Plex login, authorizes the shown code on plex.tv, and the system polls the pin id
- **THEN** the system receives and stores the returned `authToken` as the Plex token and reports a successful login

#### Scenario: PIN expires

- **WHEN** the PIN expires before the user authorizes it
- **THEN** the system stops polling and reports that the PIN expired, leaving the existing token (if any) unchanged

### Requirement: Discover Plex connections (local/remote)

After a Plex token is available, the system SHALL discover the user's Plex servers and their connections via `GET https://plex.tv/api/v2/resources?includeHttps=1`, exposing for each connection its URI/address, whether it is `local`, and whether it is a relay, so the user can pick a connection instead of typing a URL. A chosen connection SHALL be verified with a connection test before being saved as the active Plex URL.

#### Scenario: Connections discovered and selectable

- **WHEN** a Plex token exists and the user requests connection discovery
- **THEN** the system lists each Plex server with its connections labeled local or remote (relay flagged) and their URIs for selection

#### Scenario: Chosen connection saved after test

- **WHEN** the user selects a discovered local or remote connection
- **THEN** the system runs a connection test against that URI and, on success, saves it as the active Plex base URL


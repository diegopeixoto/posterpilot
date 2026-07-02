# media-server Specification (delta)

## MODIFIED Requirements

### Requirement: List libraries and items through a provider

Each provider SHALL list the server's movie and show libraries (excluding non-media libraries), and for a chosen library SHALL list its items, returning for each item a stable identifier, title, year, type (movie/show), the set of external GUIDs (tmdb/imdb/tvdb when present), the URL of its current poster (and current background/art when available), a watched flag, and the date the item was added to the server. The watched flag SHALL be true for a movie the server account has played at least once (Plex `viewCount > 0`, Jellyfin/Emby `UserData.Played`) and for a show whose episodes are all played (Plex `viewedLeafCount >= leafCount`, Jellyfin/Emby `UserData.Played`); when the server omits watched data the flag SHALL be false. The date added SHALL be mapped from Plex `addedAt` and Jellyfin/Emby `DateCreated`, and SHALL be null when the server omits it or the value is invalid. An item lacking any external GUID SHALL still be returned and flagged as unresolvable rather than omitted.

#### Scenario: Libraries enumerated

- **WHEN** a connection is established and the user requests libraries
- **THEN** the provider returns each movie and show library with its key/id, title, and type, excluding music, photos, and other non-media libraries

#### Scenario: Items returned with metadata

- **WHEN** the user opens a library
- **THEN** the provider returns the library's items, each with a stable id, title, year, type, external GUIDs, watched flag, date added, and current poster URL (and current background URL when the server exposes one)

#### Scenario: Item missing external GUIDs

- **WHEN** an item has no tmdb/imdb/tvdb GUID
- **THEN** the provider still returns the item and flags it unresolvable for MediaUX lookup rather than dropping it

#### Scenario: Watched flag mapped per server type

- **WHEN** items are listed from Plex, Jellyfin, or Emby
- **THEN** each item's watched flag reflects that server's played state (movie played at least once; show fully played), and items without watched data report false

#### Scenario: Date added mapped per server type

- **WHEN** items are listed from Plex, Jellyfin, or Emby
- **THEN** each item carries its server date-added (Plex `addedAt`, Jellyfin/Emby `DateCreated`), and items with missing or invalid values report null

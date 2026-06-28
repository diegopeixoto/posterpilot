## ADDED Requirements

### Requirement: List a show's season and episode children through a provider

Each provider SHALL list a show's season children and, for a given season, its episode
children, returning for each child a stable identifier and its season or episode number, so
the application can map number-keyed artwork to the correct child. The rest of the
application SHALL obtain children only through the `MediaServer` interface and SHALL NOT
call any provider's HTTP API directly.

#### Scenario: Plex children listed

- **WHEN** the active provider is Plex and the application requests a show's children
- **THEN** the provider returns the show's seasons (each with its rating key and season
  number) and, for a season, its episodes (each with its rating key and episode number)

#### Scenario: Jellyfin or Emby children listed

- **WHEN** the active provider is Jellyfin or Emby and the application requests a show's
  children
- **THEN** the provider returns the show's seasons and episodes, each with its item id and
  its season or episode number

### Requirement: Apply artwork to season and episode children through a provider

Each provider SHALL set a season child's poster and background and an episode child's title
card (the child's primary image) from an image URL, and SHALL lock the corresponding field
so the server's agents do not overwrite it. When the server rejects a child upload, the
provider SHALL report that child's failure with the server's status and SHALL NOT lock the
field, without affecting other children.

#### Scenario: Season poster applied to a child

- **WHEN** the application applies a season poster to a season child via the active provider
- **THEN** the provider sets it as that season's poster, locks the field, and reports success

#### Scenario: Episode title card applied to a child

- **WHEN** the application applies a title card to an episode child via the active provider
- **THEN** the provider sets it as that episode's image, locks the field, and reports success

#### Scenario: Child upload rejected

- **WHEN** the media server returns an error while setting a child's image
- **THEN** the provider reports that child's failure with the server's status, does not lock
  the field, and the failure does not prevent applying the other children

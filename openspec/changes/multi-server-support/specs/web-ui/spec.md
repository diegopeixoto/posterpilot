## MODIFIED Requirements

### Requirement: Settings view

The system SHALL provide a settings view to choose the active media server type (Plex, Jellyfin, or Emby), enter and test the active provider's connection credentials, and configure the TMDB credential, Kometa assets directory, and default apply method. For Plex, the view SHALL offer a "Log in" button that runs the PIN-based token-acquire flow and a local/remote connection picker populated from plex.tv connection discovery, so the user need not paste a token or type a URL. For Jellyfin and Emby, the view SHALL offer base URL + API key fields. Saving SHALL validate connectivity for the active provider (and TMDB) and persist the configuration, reporting any validation failure inline.

#### Scenario: Server type selected

- **WHEN** the user selects a server type (Plex, Jellyfin, or Emby)
- **THEN** the settings view shows that provider's credential fields and connection controls, and the active type is persisted on save

#### Scenario: Plex login via PIN

- **WHEN** the user clicks the Plex "Log in" button
- **THEN** the view shows the PIN code and plex.tv authorization link, polls until a token is acquired, and indicates that a Plex token is now set without revealing it

#### Scenario: Plex connection picked

- **WHEN** a Plex token is available and the user opens the connection picker
- **THEN** the view lists discovered Plex connections labeled local or remote (relay flagged) and lets the user select one as the Plex URL, which is tested before saving

#### Scenario: Jellyfin or Emby credentials saved and validated

- **WHEN** the user enters a Jellyfin/Emby base URL and API key and saves
- **THEN** the system tests connectivity against that provider and persists the configuration, reporting any validation failure inline

#### Scenario: Settings saved and validated

- **WHEN** the user enters configuration in settings and saves
- **THEN** the system validates connectivity (the active media server and TMDB) and persists the configuration, reporting any validation failure inline

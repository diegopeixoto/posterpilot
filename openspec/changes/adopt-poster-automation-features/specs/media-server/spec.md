## ADDED Requirements

### Requirement: Emby/Jellyfin login by username and password

The system SHALL allow Emby and Jellyfin users to authenticate with a username and password,
exchanging them server-side for an access token that is stored as the server's secret credential, so
that pasting an API key is no longer required. Manual API-key entry SHALL remain available as a
fallback.

#### Scenario: Successful login by name

- **WHEN** the user enters a valid Emby/Jellyfin base URL, username, and password and submits the login form
- **THEN** the system authenticates against the server, obtains an access token, stores it as the (encrypted) server credential, and reports the connection as authenticated

#### Scenario: Invalid credentials

- **WHEN** the username or password is rejected by the media server
- **THEN** the system reports an authentication failure without storing a credential

#### Scenario: Manual key fallback preserved

- **WHEN** the user opens the advanced/manual option instead of logging in
- **THEN** the user can still paste an API key directly and have it stored as the credential

### Requirement: Re-authentication on rejected token

The system SHALL detect a rejected/expired Emby/Jellyfin access token at request time and SHALL
surface a re-login prompt.

#### Scenario: Token rejected during use

- **WHEN** a media-server request fails with an unauthorized status because the stored token is no longer valid
- **THEN** the system indicates the credential is no longer valid and prompts the user to log in again

### Requirement: Expose per-item server modification timestamp

The media server provider interface SHALL expose, for each library item, the server's last-modified
timestamp where available, so callers can detect items changed since a previous sync.

#### Scenario: Item carries a server timestamp

- **WHEN** the system lists items through a provider that reports a per-item modification time (Plex `updatedAt`, Jellyfin/Emby `DateLastModified`)
- **THEN** each returned item includes that timestamp

#### Scenario: Timestamp absent

- **WHEN** a provider does not report a per-item modification time
- **THEN** the item's server timestamp is null and callers treat it as "unknown / always re-check"

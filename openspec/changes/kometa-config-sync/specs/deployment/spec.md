## ADDED Requirements

### Requirement: Mounted Kometa config file

The system SHALL be able to read and write the user's existing Kometa `config.yml` from inside the container when that file (or its directory) is provided as a mounted volume and its path is supplied via configuration. Writes SHALL be atomic and SHALL leave a backup, so the user's existing Kometa configuration on the host cannot be corrupted by a failed write.

#### Scenario: Config file mounted and updated

- **WHEN** the container is started with Kometa's config directory mounted and the config-file path configured
- **THEN** PosterPilot can read the host's `config.yml`, write surgical updates back to it atomically with a backup, and the changes are visible to the host and to Kometa

#### Scenario: Config path not mounted

- **WHEN** no Kometa config-file path is configured or the path is not mounted into the container
- **THEN** the Kometa config-sync feature stays inactive and the rest of the application runs normally

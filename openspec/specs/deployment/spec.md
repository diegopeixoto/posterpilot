# deployment Specification

## Purpose

Define the self-hosted container deployment model and its persistent data, mounted Kometa, and runtime configuration requirements.
## Requirements
### Requirement: Single-container deployment

The system SHALL build into a single Docker image that runs the full application (web UI, API, and background worker) in one container, runnable identically on macOS and on an Unraid server.

#### Scenario: Image runs the whole app

- **WHEN** the image is started with the required environment and volumes
- **THEN** the web UI, API endpoints, and background worker are all available from the single container on the configured port

#### Scenario: Same image on Mac and Unraid

- **WHEN** the same image is run on a Mac and on Unraid
- **THEN** it behaves identically given equivalent environment and mounted volumes

### Requirement: Persistent data volume

The system SHALL store its SQLite database in a mounted volume so library data, history, and settings persist across container restarts and image updates.

#### Scenario: Data survives restart

- **WHEN** the container is recreated with the same data volume mounted
- **THEN** previously synced library data, applied-poster history, and saved settings are still present

### Requirement: Mounted Kometa assets directory

The system SHALL write Kometa exports into a directory provided as a mounted volume, so the user's existing Kometa instance can consume them.

#### Scenario: Exports land in the mounted directory

- **WHEN** a Kometa export runs in the container with the assets directory mounted
- **THEN** the generated YAML is written into the mounted directory and is visible to the host and to Kometa

### Requirement: Configuration via environment and compose

The system SHALL accept credentials and paths via environment variables, and SHALL ship a documented `docker-compose` file for Unraid that wires the data volume, the Kometa assets volume, the published port, and the required environment.

#### Scenario: Compose brings the service up

- **WHEN** the user fills the documented environment in the compose file and starts it
- **THEN** the service comes up with both volumes mounted and is reachable on the published port

### Requirement: Mounted Kometa config file

The system SHALL be able to read and write the user's existing Kometa `config.yml` from inside the container when that file (or its directory) is provided as a mounted volume and its path is supplied via configuration. Writes SHALL be atomic and SHALL leave a backup, so the user's existing Kometa configuration on the host cannot be corrupted by a failed write.

#### Scenario: Config file mounted and updated

- **WHEN** the container is started with Kometa's config directory mounted and the config-file path configured
- **THEN** PosterPilot can read the host's `config.yml`, write surgical updates back to it atomically with a backup, and the changes are visible to the host and to Kometa

#### Scenario: Config path not mounted

- **WHEN** no Kometa config-file path is configured or the path is not mounted into the container
- **THEN** the Kometa config-sync feature stays inactive and the rest of the application runs normally

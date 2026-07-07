## MODIFIED Requirements

### Requirement: Single-container deployment

The system SHALL build into a single Docker image that runs the full application (web UI, API, and background worker) in one container, runnable identically on macOS and on an Unraid server. The image SHALL be built from a pinned base image, and SHALL define a `HEALTHCHECK` that probes the application's health endpoint without requiring extra tools in the runtime image.

#### Scenario: Image runs the whole app

- **WHEN** the image is started with the required environment and volumes
- **THEN** the web UI, API endpoints, and background worker are all available from the single container on the configured port

#### Scenario: Same image on Mac and Unraid

- **WHEN** the same image is run on a Mac and on Unraid
- **THEN** it behaves identically given equivalent environment and mounted volumes

#### Scenario: Healthcheck reports readiness

- **WHEN** the container has started and the app is serving
- **THEN** the container's `HEALTHCHECK` transitions the container to healthy by probing the health endpoint

### Requirement: Configuration via environment and compose

The system SHALL accept credentials and paths via environment variables, and SHALL ship a documented `docker-compose` file for Unraid that wires the data volume, the Kometa assets volume, the published port, and the required environment. The documentation SHALL cover the authentication-related environment variables (`AUTH_MODE`, and `ADDRESS_HEADER`/`XFF_DEPTH` for reverse-proxy trust).

#### Scenario: Compose brings the service up

- **WHEN** the user fills the documented environment in the compose file and starts it
- **THEN** the service comes up with both volumes mounted and is reachable on the published port

#### Scenario: Auth and proxy env documented

- **WHEN** an operator wants to enable authentication behind a reverse proxy
- **THEN** the documentation explains `AUTH_MODE` and how to configure `ADDRESS_HEADER`/`XFF_DEPTH` so `local` mode is fail-closed and not spoofable

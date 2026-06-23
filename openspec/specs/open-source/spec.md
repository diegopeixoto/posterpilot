# open-source Specification

## Purpose
TBD - created by archiving change open-source-release. Update Purpose after archive.
## Requirements
### Requirement: MIT license

The repository SHALL include an MIT `LICENSE` file naming the copyright holder, and the README SHALL state that the project is MIT-licensed.

#### Scenario: License present

- **WHEN** a visitor opens the repository
- **THEN** a `LICENSE` file containing the MIT license text and copyright holder is present and GitHub detects the project as MIT-licensed

#### Scenario: README references the license

- **WHEN** a visitor reads the README
- **THEN** the README states the project is released under the MIT license and links to `LICENSE`

### Requirement: Contribution and conduct guidance

The repository SHALL include a `CONTRIBUTING.md` that documents local setup and the required quality gates (`bun run check`, `bun run test`, `bun run format`) and pull-request expectations, and a `CODE_OF_CONDUCT.md`.

#### Scenario: Contributing guide present

- **WHEN** a prospective contributor opens `CONTRIBUTING.md`
- **THEN** it explains how to set up the project locally, which checks must pass before a PR, and how to submit changes

#### Scenario: Code of conduct present

- **WHEN** a visitor opens `CODE_OF_CONDUCT.md`
- **THEN** a code of conduct with a reporting contact is present

### Requirement: Security policy

The repository SHALL include a `SECURITY.md` describing how to privately report a vulnerability.

#### Scenario: Security policy present

- **WHEN** a reporter opens `SECURITY.md`
- **THEN** it describes a private channel and process for reporting vulnerabilities

### Requirement: Contribution templates

The repository SHALL provide GitHub issue templates for bug reports and feature requests and a pull-request template under `.github/`.

#### Scenario: Issue templates offered

- **WHEN** a user opens a new issue on GitHub
- **THEN** they are offered a bug-report template and a feature-request template

#### Scenario: PR template applied

- **WHEN** a contributor opens a pull request
- **THEN** the PR description is prefilled from the repository's pull-request template

### Requirement: Continuous integration gates

The repository SHALL run an automated CI workflow on pull requests and pushes that executes the project's type-check, tests, and format check, so regressions are caught before merge.

#### Scenario: CI runs on a pull request

- **WHEN** a pull request is opened or updated
- **THEN** CI runs `bun run check`, `bun run test`, and the format check, and reports pass/fail as a status check

#### Scenario: Failing checks block visibility

- **WHEN** any of the type-check, tests, or format check fails
- **THEN** the CI run is marked failed for that pull request

### Requirement: Funding metadata

The repository SHALL include a `.github/FUNDING.yml` with the maintainer's sponsor links.

#### Scenario: Funding configured

- **WHEN** a visitor views the repository on GitHub
- **THEN** a Sponsor option is shown, sourced from `.github/FUNDING.yml`

### Requirement: Copyright attribution

The `LICENSE` file SHALL name the copyright holder "Diego Peixoto" and the release year, and the README SHALL include a short copyright/notice line in its footer.

#### Scenario: License names holder and year

- **WHEN** a visitor opens the `LICENSE` file
- **THEN** the copyright line reads "Copyright (c) <year> Diego Peixoto" with the current release year

#### Scenario: README footer carries a notice

- **WHEN** a visitor reads the bottom of the README
- **THEN** a footer line attributes copyright to Diego Peixoto and references the MIT license

### Requirement: Official container image publishing

The repository SHALL publish a multi-architecture (linux/amd64 and linux/arm64) container image to GitHub Container Registry at `ghcr.io/diegopeixoto/posterpilot` on tagged releases, built with `docker/build-push-action`, and the README SHALL document pulling and running the official image.

#### Scenario: Image published on a tagged release

- **WHEN** a release tag (e.g. `v1.2.0`) is created
- **THEN** a workflow builds the image for both `linux/amd64` and `linux/arm64` and pushes it to `ghcr.io/diegopeixoto/posterpilot`

#### Scenario: Image tagged with version and latest

- **WHEN** the image for release `v1.2.0` is pushed
- **THEN** it is tagged with the semantic version (`1.2.0`), the major/minor aliases, and `latest`

#### Scenario: README documents the official image

- **WHEN** a user reads the README deployment section
- **THEN** it shows how to `docker pull ghcr.io/diegopeixoto/posterpilot:latest` and run it with the required volumes and environment

#### Scenario: Image runs on Mac and Unraid hardware

- **WHEN** the published image is pulled on an arm64 Mac and on an amd64 Unraid host
- **THEN** the matching architecture variant is selected automatically and the container starts on both

### Requirement: Release automation and changelog

The repository SHALL automate versioning, changelog, tags, and GitHub Releases from Conventional Commits using `release-please`, which maintains a release pull request that updates `CHANGELOG.md` and the package version and, when merged, creates the tag and GitHub Release.

#### Scenario: Release PR maintained from commits

- **WHEN** Conventional Commits (e.g. `feat:`, `fix:`) land on the default branch
- **THEN** release-please opens or updates a release pull request that bumps the version and appends the corresponding entries to `CHANGELOG.md`

#### Scenario: Merging the release PR cuts a release

- **WHEN** the maintainer merges the release pull request
- **THEN** release-please creates the version tag and a GitHub Release whose notes are generated from the Conventional Commits

#### Scenario: Release tag triggers image publish

- **WHEN** the release tag is created by release-please
- **THEN** the container-image publishing workflow runs for that tag and pushes the versioned image

### Requirement: Health endpoint

The application SHALL expose an unauthenticated `GET /api/health` endpoint that returns HTTP 200 with a JSON body reporting application status and version, so deployments can health-check the container, and the README SHALL document it.

#### Scenario: Health check returns ok and version

- **WHEN** a client sends `GET /api/health`
- **THEN** the response is HTTP 200 with a JSON body containing `status: "ok"` and the running application `version`

#### Scenario: Endpoint requires no authentication

- **WHEN** an orchestrator (Docker/Unraid health check) calls `GET /api/health` without credentials
- **THEN** it receives the 200 status response and can use it as a container health probe

#### Scenario: README documents the endpoint

- **WHEN** an operator reads the README
- **THEN** it documents the `/api/health` endpoint and shows an example container health-check using it


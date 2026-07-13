# documentation Specification

## Purpose
Define the maintained documentation site, its installation/configuration/usage/contribution content, localization, and publication workflow.
## Requirements
### Requirement: Static documentation site

The project SHALL include a static documentation site, built with Astro
Starlight, that lives in a dedicated `docs/` directory with its own dependencies
isolated from the application package, and SHALL build to static HTML/CSS/JS
suitable for hosting on a static host. The site SHALL provide site-wide
navigation and full-text search across its pages.

#### Scenario: Site builds to static output

- **WHEN** the documentation site's build command is run from the `docs/`
  directory
- **THEN** it produces a directory of static HTML/CSS/JS with no server-side
  runtime required to serve it

#### Scenario: Dependencies isolated from the app

- **WHEN** the documentation site's dependencies are installed
- **THEN** they are declared in the `docs/` directory's own manifest and do not
  alter the application's `package.json` or runtime dependencies

#### Scenario: Navigation and search present

- **WHEN** a reader opens any page of the built site
- **THEN** a sidebar/navigation listing the documentation sections is shown and a
  search control that finds content across pages is available

### Requirement: Installation documentation

The documentation site SHALL include an installation page that explains running
PosterPilot as a single Docker container using the published GHCR image, with
Docker Compose examples for both macOS and Unraid, the required `/data` and
`/kometa` volume mounts, the published port, and the first-run steps to reach the
UI.

#### Scenario: GHCR image and compose covered

- **WHEN** a reader follows the installation page
- **THEN** it documents pulling the GHCR image and provides Docker Compose
  examples for macOS and for Unraid, including the `/data` and `/kometa` volumes
  and the published port

#### Scenario: First run reaches the UI

- **WHEN** a reader completes the installation steps
- **THEN** the page tells them which URL/port to open to reach the running UI and
  what to expect on first run

### Requirement: Configuration documentation

The documentation site SHALL include a configuration page covering connecting a
media server (Plex, Jellyfin, and Emby), the TMDB API key, the Kometa export, and
the full set of environment variables, and SHALL explain how environment
variables relate to the in-app Settings UI, including which source takes
precedence.

#### Scenario: Media servers, TMDB, and Kometa documented

- **WHEN** a reader opens the configuration page
- **THEN** it documents connecting Plex, Jellyfin, and Emby, supplying a TMDB API
  key, and configuring the Kometa export directory

#### Scenario: Env vars and Settings UI reconciled

- **WHEN** a reader configures the app
- **THEN** the page lists the supported environment variables and explains how
  they relate to the in-app Settings page, including which source takes
  precedence

### Requirement: Usage documentation

The documentation site SHALL include a usage page that walks through syncing a
library, finding covers, applying a cover via the Plex API and via the Kometa
export, building custom sets, and using the library filters and sorting.

#### Scenario: Core workflow documented

- **WHEN** a reader opens the usage page
- **THEN** it walks through syncing a library, finding covers for a title, and
  applying a cover both via the Plex API and via the Kometa export

#### Scenario: Custom sets and library filters documented

- **WHEN** a reader wants to stage a custom poster/background pair or narrow the
  library
- **THEN** the page explains building custom sets and using the library filters
  and sort options

### Requirement: Contributing documentation

The documentation site SHALL include a contributing page that documents local
development setup and the project's quality gates (`bun run check`,
`bun run test`, and `bun run format`) that must pass before a change is
submitted.

#### Scenario: Dev setup documented

- **WHEN** a prospective contributor opens the contributing page
- **THEN** it explains how to set up the project locally for development

#### Scenario: Quality gates documented

- **WHEN** a contributor prepares a change
- **THEN** the page states that `bun run check`, `bun run test`, and
  `bun run format` must pass before submitting

### Requirement: Translating documentation

The documentation site SHALL include a translating page that documents the
Weblate workflow for contributing UI translations, so translators can find and
follow the localization process.

#### Scenario: Weblate workflow documented

- **WHEN** a translator opens the translating page
- **THEN** it describes the Weblate workflow for contributing and reviewing UI
  translations and links to the project's translation location

### Requirement: CI build and GitHub Pages deploy

The project SHALL build the documentation site in CI via a GitHub Actions
workflow. On pushes to the `main` branch the workflow SHALL build the site and
deploy it to GitHub Pages. On pull requests the workflow SHALL build the site
(without deploying) so that a build failure blocks the pull request. The
published site SHALL serve the documentation at a stable GitHub Pages URL.

#### Scenario: Deploy on push to main

- **WHEN** a commit is pushed to `main` that the workflow runs against
- **THEN** the workflow builds the documentation site and deploys the built
  output to GitHub Pages, and the updated site is served at the GitHub Pages URL

#### Scenario: Build-only on pull requests

- **WHEN** a pull request is opened or updated
- **THEN** the workflow builds the documentation site without deploying, and a
  failing build is reported as a failed status check on the pull request

### Requirement: README links to the documentation site

The README SHALL link to the published documentation site, including a
documentation badge, so visitors can reach the full docs from the repository
landing page.

#### Scenario: README documentation link present

- **WHEN** a visitor reads the README
- **THEN** it contains a documentation badge and a link to the published
  documentation site URL

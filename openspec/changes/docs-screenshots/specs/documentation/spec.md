## ADDED Requirements

### Requirement: Illustrated documentation

The documentation SHALL illustrate the key product surfaces with screenshots — the dashboard, the
library grid, item detail / apply, Settings (including Security), the Kometa manager, and the first-run
wizard — embedded at the relevant points in the installation, configuration, and usage pages, each with
descriptive alt text, and bundled by the docs build.

#### Scenario: Key surfaces illustrated

- **WHEN** a reader views the installation, configuration, or usage documentation
- **THEN** the relevant surface is shown with a screenshot that has descriptive alt text

#### Scenario: Assets bundled by the build

- **WHEN** the documentation site is built
- **THEN** the screenshot assets are bundled and their references resolve

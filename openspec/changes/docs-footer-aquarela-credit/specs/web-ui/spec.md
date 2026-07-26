# web-ui — delta

## ADDED Requirements

### Requirement: App footer displays project credits
The app footer SHALL display, on every page, a credits line containing: the project
link to the GitHub repository, the running app version as `v<version>` (read from
`package.json` at build time via `$lib/version`), a copyright line
`© <current year> Diego Peixoto` linking to `https://github.com/diegopeixoto`, an
Aquarela company credit ("An app from Aquarela") linking to `https://aquarela.io`,
and the localized trademark disclaimer. The Aquarela label MUST be localized via an
i18n catalog key present in all five locales.

#### Scenario: Credits visible on any app page
- **WHEN** a user views any page of the app
- **THEN** the footer shows the project link, `v<version>`, the copyright link to the maintainer's GitHub profile, the Aquarela link, and the localized disclaimer

#### Scenario: External credit links are safe
- **WHEN** the copyright or Aquarela link is activated
- **THEN** it opens the external site in a new tab with `rel="noopener"`, matching the existing project link behavior

#### Scenario: Locale switch localizes the labels
- **WHEN** the user switches the app language
- **THEN** the disclaimer and the Aquarela label change language while names, the version, and link targets remain identical

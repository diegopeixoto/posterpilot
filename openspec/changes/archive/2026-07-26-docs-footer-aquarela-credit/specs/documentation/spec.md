# documentation — delta

## ADDED Requirements

### Requirement: Docs footer displays project credits
The docs site footer SHALL display a credits row on every page and every locale
containing: a copyright line `© <current year> Diego Peixoto` linking to
`https://github.com/diegopeixoto`, a link to the project's GitHub stargazers, the
current app version rendered as `v<version>` linking to the repository's releases
page, and an Aquarela company credit linking to `https://aquarela.io`. The version
MUST be read from the root `package.json` at build time so the docs always show the
released app version without manual edits.

#### Scenario: Credits visible on any docs page
- **WHEN** a visitor opens any docs page in any locale
- **THEN** the footer shows the copyright link, the stargazers link, the `v<version>` releases link, and the Aquarela link, each resolving to its target URL

#### Scenario: Version tracks the app release
- **WHEN** the root `package.json` version changes and the docs are rebuilt
- **THEN** the footer version link text updates to the new `v<version>` with no docs-source edit

#### Scenario: Aquarela credit styling and safety
- **WHEN** the Aquarela link is rendered
- **THEN** it uses the same muted credit styling and hover highlight as the other credit links, and opens the external site with `rel` attributes that prevent opener access

### Requirement: Docs footer displays a trademark disclaimer
The docs site footer SHALL display, on every page and every locale, a disclaimer
stating that PosterPilot is an independent project not affiliated with or endorsed
by Plex, Jellyfin, Emby, MediUX, Fanart.tv, TMDB, ThePosterDB, or Kometa, and that
it uses the TMDB API without TMDB endorsement or certification.

#### Scenario: Disclaimer visible on any docs page
- **WHEN** a visitor opens any docs page in any locale
- **THEN** the footer shows the trademark/affiliation disclaimer text

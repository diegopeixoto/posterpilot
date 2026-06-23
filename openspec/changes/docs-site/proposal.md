## Why

PosterPilot's only user-facing documentation is the README, which is already
stretched thin covering install, Docker, configuration, and Kometa. As the
project goes public (open-source-release) and gains translation (i18n), it needs
a real documentation site — browsable, searchable, versionable, and broad enough
to cover installation, configuration, day-to-day usage, contributing, and
translating — without bloating the README. A static docs site that builds in CI
and deploys to GitHub Pages gives new self-hosters and contributors a single,
authoritative reference and frees the README to be a concise landing page that
links out.

## What Changes

- **Add a static documentation site** built with Astro Starlight under a
  top-level `docs/` directory, with its own dependencies isolated from the app.
- **Author the core content set**:
  - **Installation** — Docker Compose for Mac and for Unraid, pulling the GHCR
    image, the `/data` and `/kometa` volumes, and first-run steps.
  - **Configuration** — media servers (Plex/Jellyfin/Emby), TMDB key, Kometa
    export, and the full environment-variable set alongside the in-app Settings
    UI (env vs. Settings precedence).
  - **Usage** — sync a library, find covers, apply (Plex API and Kometa export),
    custom sets, and library filters/sorting.
  - **Contributing** — local dev setup and the quality gates
    (`bun run check` / `test` / `format`).
  - **Translating** — the Weblate workflow for contributing UI translations.
- **Build and deploy in CI** — a GitHub Actions workflow builds the site and
  deploys it to GitHub Pages on pushes to `main`, with a build-only check on
  pull requests so broken docs are caught before merge.
- **Link the site from the README** — a documentation badge and a prominent link
  to the published site.

## Capabilities

### New Capabilities

- `documentation`: A static documentation site covering installation,
  configuration, usage, contributing, and translating, built in CI and deployed
  to GitHub Pages on pushes to `main`, and linked from the README.

### Modified Capabilities

<!-- None — this change adds a documentation site and its deploy pipeline,
     not runtime application behavior. The translating page and the GitHub Pages
     workflow coordinate with the i18n-localization and open-source-release
     changes but do not modify their requirements. -->

## Impact

- **New files:** a `docs/` site scaffold (Astro Starlight config, content pages
  for installation / configuration / usage / contributing / translating, and the
  site's own `package.json`); `.github/workflows/docs.yml` (build + GitHub Pages
  deploy).
- **Modified files:** `README.md` (documentation badge + link to the published
  site); repository settings enable GitHub Pages from Actions.
- **No application code or runtime behavior changes.**
- **Coordination:** the translating page documents the Weblate workflow defined
  by `i18n-localization`; the docs CI workflow is a sibling of the
  `open-source-release` CI (separate workflow, same Bun toolchain) and does not
  alter it.

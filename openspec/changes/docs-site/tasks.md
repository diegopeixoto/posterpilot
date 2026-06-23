## 1. Scaffold the docs site

- [ ] 1.1 Scaffold an Astro Starlight site in `docs/` with its own `package.json` and lockfile, isolated from the app package
- [ ] 1.2 Configure Starlight site metadata (title, description, logo, social/repo links) and the sidebar with the five sections: Installation, Configuration, Usage, Contributing, Translating
- [ ] 1.3 Set Astro `site` and `base` for the GitHub Pages project path so internal links and the search index resolve
- [ ] 1.4 Verify a clean local build: install + build inside `docs/` produces static output and `bun install` for the app does not pull docs dependencies

## 2. Author core content

- [ ] 2.1 Installation page: GHCR image, Docker Compose for macOS and for Unraid, `/data` and `/kometa` volumes, published port, first-run steps to reach the UI
- [ ] 2.2 Configuration page: connect Plex/Jellyfin/Emby, TMDB key, Kometa export dir, full env-var table, and env-vs-Settings-UI precedence
- [ ] 2.3 Usage page: sync a library, find covers, apply via Plex API and via Kometa export, build custom sets, library filters and sorting
- [ ] 2.4 Contributing page: local dev setup and the `bun run check` / `test` / `format` quality gates
- [ ] 2.5 Translating page: the Weblate workflow for contributing UI translations (mirroring the i18n change), with a link to the translation location
- [ ] 2.6 Landing/index page introducing the project and linking into the sections

## 3. CI build and GitHub Pages deploy

- [ ] 3.1 Add `.github/workflows/docs.yml`: build the site on `pull_request` (no deploy) and build+deploy on push to `main`, scoped via `docs/**` path filters with `workflow_dispatch`
- [ ] 3.2 Wire the deploy with `actions/upload-pages-artifact` + `actions/deploy-pages`, the `pages: write` / `id-token: write` permissions, and a `github-pages` environment
- [ ] 3.3 Enable GitHub Pages "Build and deployment → GitHub Actions" in repository settings
- [ ] 3.4 Confirm the build-only PR path fails the check on a broken build, and the `main` path publishes to the Pages URL with links/search working

## 4. README integration

- [ ] 4.1 Add a documentation badge and a prominent link to the published site in `README.md`
- [ ] 4.2 Trim deep install/config/Kometa detail from the README that now lives on the site, pointing readers to the docs

## 5. Verification

- [ ] 5.1 Local docs build is clean; site serves with working navigation and search
- [ ] 5.2 Published GitHub Pages URL serves the five sections and the README link resolves to it
- [ ] 5.3 `openspec validate docs-site` passes

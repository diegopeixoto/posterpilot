## Context

PosterPilot is a self-hosted SvelteKit (Svelte 5 runes) + Bun + Drizzle/SQLite
app whose only documentation today is the README. The README already carries the
load for install (Docker on Mac and Unraid), configuration (env vars + Settings
UI), and the Kometa export, and it is near its useful limit. Two adjacent
in-flight changes raise the stakes: `open-source-release` makes the repo public
(adding `CONTRIBUTING.md`, CI, badges) and `i18n-localization` adds a Weblate
translation workflow that needs a home for contributor instructions. A dedicated
documentation site lets the README shrink to a landing page while the deep
material moves somewhere browsable, searchable, and independently deployable.

Constraints: the site must not entangle the app's build or dependencies; it must
build to static files (the deploy target is GitHub Pages, a static host); and its
CI must reuse the existing Bun toolchain without modifying the app's CI workflow
from `open-source-release`.

## Goals / Non-Goals

**Goals:**

- A static, searchable documentation site under `docs/`, with dependencies fully
  isolated from the app.
- Cover the five content areas: installation, configuration, usage,
  contributing, translating — concrete enough to follow end-to-end.
- Build the site in CI; deploy to GitHub Pages on pushes to `main`; build-only on
  pull requests so broken docs fail the PR.
- Link the site from the README (badge + link), letting the README slim down.

**Non-Goals:**

- No changes to application code, runtime behavior, the app's build, or the app's
  CI workflow.
- No documentation versioning (multiple released-version doc trees) in this
  change — single "latest" docs tracking `main`.
- No custom domain, analytics, or comment system.
- No authoring of the translation strings themselves — that is `i18n`; this
  change only documents the contributor workflow.
- No API reference auto-generation — the app has no public API contract to
  document.

## Decisions

**1. Astro Starlight as the docs framework (VitePress as the alternative).**
Use Astro Starlight, located in `docs/`. Starlight ships search, dark mode,
i18n-ready navigation, and a strong content-collections authoring model
out-of-the-box, and Astro's static output drops cleanly onto GitHub Pages. It
also leaves the door open to localize the docs themselves later (matching the
project's i18n direction) without re-platforming.
_Alternative — VitePress:_ lighter and Vue-based, equally capable for a small
docs set and a common choice for self-hosted tooling. Rejected as primary mainly
because Starlight's built-in i18n and component story aligns better with the
project's localization trajectory; either would satisfy the spec, so VitePress
remains a clean fallback if Starlight friction appears.

**2. Isolated `docs/` workspace, not a dependency of the app.**
The site has its own `package.json` and lockfile under `docs/`. The app's
`package.json` is untouched, so `bun install` for the app never pulls Astro, and
the docs build can use whatever toolchain Starlight prefers without constraining
the app. CI installs and builds inside `docs/` only.
_Alternative:_ a monorepo workspace sharing the root `package.json` (rejected —
couples the app's dependency graph and CI to the docs framework for no benefit at
this scale).

**3. Separate `docs.yml` workflow; do not touch the app CI.**
Add `.github/workflows/docs.yml` distinct from the `open-source-release`
`ci.yml`. It triggers on `push` to `main` (build + deploy) and on `pull_request`
(build only). Deploy uses the official GitHub Pages Actions
(`actions/upload-pages-artifact` + `actions/deploy-pages`) with the
`pages: write` / `id-token: write` permissions and a `github-pages` environment.
Path filters scope it to `docs/**` and the workflow itself so unrelated app
changes do not trigger a docs deploy, while still allowing a manual
`workflow_dispatch`.
_Alternative:_ fold docs into the app `ci.yml` (rejected — mixes concerns,
couples docs deploys to app-test timing, and the task explicitly keeps app CI in
`open-source-release`).

**4. Single "latest" docs, tracking `main`.**
No multi-version docs tree. The site documents the current `main`. This keeps the
build trivial and matches a single-container self-hosted app with rolling
releases. Versioned docs can be added later if releases diverge meaningfully.

**5. Content sourced from the README and the in-flight specs, then the README
links back.**
Migrate and expand the README's install/config/Kometa material into the site,
add usage/contributing/translating, then reduce the README to a landing page with
a documentation badge and link. Configuration content reconciles env vars with
the Settings UI (precedence) per the `configuration` spec; translating content
mirrors the `i18n` Weblate workflow; contributing mirrors the
`open-source-release` quality gates — single-sourced descriptions to avoid drift.

**6. Set Astro `site` and `base` for the GitHub Pages path.**
For a project Pages site served under `/<repo>/`, configure Astro's `site` and
`base` so internal links and the search index resolve correctly. Document the one
value to change if the site later moves to a user/custom domain.

## Risks / Trade-offs

- **GitHub Pages base-path link breakage** → Internal/asset links can 404 if
  `base` is misconfigured for a project Pages path. Mitigate by setting Astro
  `site`/`base` explicitly and verifying the built site against the Pages URL
  before relying on it.
- **Docs drift from the app** → Install/config steps can fall behind the code.
  Mitigate by single-sourcing from the same facts the specs assert (env vars,
  volumes, gates) and treating doc updates as part of relevant feature changes.
- **Second toolchain in the repo** → A separate Astro/Node toolchain alongside
  Bun adds maintenance surface. Mitigate by isolating it entirely under `docs/`
  with its own lockfile and a dedicated workflow, so it never touches app
  development.
- **Coordination ordering with i18n / open-source-release** → The translating
  page references the Weblate workflow and the README badges sit near the
  open-source badges. Mitigate by writing the translating page to the workflow
  i18n defines (not duplicating its setup) and adding the docs badge alongside,
  not replacing, the others.

## Migration Plan

1. Scaffold the Starlight site in `docs/` with its own `package.json`; add the
   five content pages (initially porting README material, then expanding).
2. Configure Astro `site`/`base` for the GitHub Pages project path.
3. Add `.github/workflows/docs.yml` (build on PR, build+deploy on `main`); enable
   GitHub Pages "Build and deployment → GitHub Actions" in repo settings.
4. Push to `main`; confirm the site publishes at the Pages URL and links/search
   resolve.
5. Add the README documentation badge + link; trim duplicated deep content from
   the README to point at the site.
6. Rollback: disable/remove `docs.yml` and the `docs/` directory; the README link
   reverts. No application impact since nothing in the app depends on the site.

## Open Questions

- Final Pages URL shape — project Pages (`/<repo>/`) vs. a future custom domain;
  affects Astro `base`. Default to project Pages for now.
- Whether to localize the docs site itself later (Starlight i18n) once UI
  translations exist — out of scope here, but the framework choice keeps it open.
- Exact depth of the configuration matrix for Jellyfin/Emby pending those
  integrations' maturity in `multi-server-support`; document what exists and mark
  anything provisional.

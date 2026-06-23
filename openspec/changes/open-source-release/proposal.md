## Why

PosterPilot is a clean, self-hosted app that others would benefit from running and contributing to. To release it publicly under `github.com/diegopeixoto/posterpilot`, the repository needs the standard open-source scaffolding — a license, contribution and conduct guidelines, a security policy, contribution templates, and CI that enforces the project's existing quality gates — so external contributors can use it and submit changes with confidence.

## What Changes

- **Adopt the MIT license** — add a `LICENSE` file naming the copyright holder, and reference it from the README.
- **Add contribution guidance** — `CONTRIBUTING.md` (dev setup, the `bun run check` / `test` / `format` gates, branch/PR expectations) and a `CODE_OF_CONDUCT.md`.
- **Add a security policy** — `SECURITY.md` describing how to privately report vulnerabilities.
- **Add GitHub templates** — issue templates (bug report, feature request) and a pull-request template under `.github/`.
- **Add CI** — a GitHub Actions workflow that runs `bun run check`, `bun run test`, and `bun run format`-check on pull requests and pushes.
- **Add funding metadata** — `.github/FUNDING.yml` with sponsor links.
- **Publish an official container image** — on tagged releases, build a multi-arch (amd64 + arm64) image with `docker/build-push-action` and push it to GitHub Container Registry (`ghcr.io/diegopeixoto/posterpilot`); document pulling the official image in the README. Optionally mirror to Docker Hub.
- **Automate releases and the changelog** — adopt `release-please` (`googleapis/release-please-action`) driven by Conventional Commits: a release PR maintains `CHANGELOG.md`, bumps the package version, and on merge creates the tag and GitHub Release notes; the tag triggers the image publish.
- **Set copyright attribution** — name "Diego Peixoto" and the release year in `LICENSE`, and add a short copyright/notice line to the README footer.
- **Add a health endpoint** — a lightweight `GET /api/health` returning `{ status, version }` so deployments can health-check the container; documented in the README.
- **Polish the README for a public audience** — badges (build/CI, latest release, license, Docker image, and a translation-status placeholder), a screenshot/feature section, and a clear quickstart, building on the existing content.

## Capabilities

### New Capabilities

- `open-source`: Repository-level requirements for a public open-source release — license + copyright attribution, contribution/conduct/security docs, contribution templates, CI quality gates, official multi-arch container-image publishing to GHCR, Conventional-Commits release automation (release-please) with a maintained changelog, and a documented `/api/health` endpoint for deployment health checks.

### Modified Capabilities

<!-- None — runtime impact is limited to a single additive /api/health route, captured under the open-source capability's "Health endpoint" requirement rather than altering an existing capability. -->

## Impact

- **New files:** `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `.github/workflows/docker-publish.yml`, `.github/FUNDING.yml`, `release-please-config.json` + `.release-please-manifest.json`, `CHANGELOG.md` (seeded), and `src/routes/api/health/+server.ts`.
- **Modified files:** `README.md` (badges, screenshots, quickstart, license + copyright footer, official-image pull instructions, `/api/health` docs), `package.json` (version managed by release-please), and `docker-compose.yml` (optional `healthcheck:` referencing `/api/health`).
- **Application code:** adds one small unauthenticated `GET /api/health` route; no change to existing runtime behavior.
- **CI / release:** introduces a required-checks pipeline plus release automation (release-please) and a release-triggered multi-arch container publish to GHCR.
- **Registry:** the project begins publishing `ghcr.io/diegopeixoto/posterpilot` images; this is the canonical pull source documented in the README.

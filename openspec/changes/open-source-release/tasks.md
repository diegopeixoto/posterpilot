## 1. License & copyright

- [ ] 1.1 Add MIT `LICENSE` naming "Diego Peixoto" and the current year
- [ ] 1.2 Reference the MIT license in `README.md` with a link to `LICENSE`
- [ ] 1.3 Add a short copyright/notice line to the README footer ("Copyright (c) <year> Diego Peixoto — MIT")

## 2. Community docs

- [ ] 2.1 Add `CONTRIBUTING.md`: local setup (bun install, env, db:generate, dev), required gates (`bun run check` / `test` / `format`), branch + PR expectations
- [ ] 2.2 Add `CODE_OF_CONDUCT.md` (Contributor Covenant) with a reporting contact
- [ ] 2.3 Add `SECURITY.md` describing the private vulnerability-reporting process

## 3. GitHub templates

- [ ] 3.1 Add `.github/ISSUE_TEMPLATE/bug_report.md` (or `.yml`)
- [ ] 3.2 Add `.github/ISSUE_TEMPLATE/feature_request.md` (or `.yml`)
- [ ] 3.3 Add `.github/ISSUE_TEMPLATE/config.yml` if disabling blank issues / adding links
- [ ] 3.4 Add `.github/PULL_REQUEST_TEMPLATE.md`

## 4. CI

- [ ] 4.1 Add `.github/workflows/ci.yml`: checkout, setup Bun (pinned version), `bun install`, `bun run check`, `bun run test`, prettier format check — on `pull_request` and pushes to `main`
- [ ] 4.2 Run `bun run format` once to normalize the tree so the format gate passes from a clean baseline
- [ ] 4.3 Verify the workflow passes (locally run the same commands; confirm green after push)

## 5. Health endpoint

- [ ] 5.1 Add `src/routes/api/health/+server.ts` exporting `GET` that returns `json({ status: 'ok', version })` (version read from `package.json`), unauthenticated and doing no I/O
- [ ] 5.2 Add a Vitest test asserting `GET /api/health` returns 200 with `status: 'ok'` and a non-empty `version`
- [ ] 5.3 Add an optional `healthcheck:` to `docker-compose.yml` that curls `http://localhost:3000/api/health`
- [ ] 5.4 Document the `/api/health` endpoint in the README (purpose, response shape, example health check)

## 6. Container image publishing

- [ ] 6.1 Add `.github/workflows/docker-publish.yml` triggered on release tags (`v*`) with `permissions: { contents: read, packages: write }`
- [ ] 6.2 Steps: checkout, `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` to GHCR using `GITHUB_TOKEN`
- [ ] 6.3 Use `docker/metadata-action` to derive tags (`latest`, full semver, major/minor) and OCI labels for `ghcr.io/diegopeixoto/posterpilot`
- [ ] 6.4 `docker/build-push-action` with `platforms: linux/amd64,linux/arm64`, `push: true`, and GHA build cache (`cache-from`/`cache-to: type=gha`)
- [ ] 6.5 (Optional) Add a Docker Hub login + tag set behind a `DOCKERHUB_TOKEN` secret, disabled by default
- [ ] 6.6 Make the GHCR package public and linked to the repo; verify anonymous `docker pull ghcr.io/diegopeixoto/posterpilot:latest` works on amd64 and arm64
- [ ] 6.7 Document pulling/running the official image in the README deployment section

## 7. Release automation & changelog

- [ ] 7.1 Add `release-please-config.json` (`release-type: node`, root package) and seed `.release-please-manifest.json` with the chosen baseline version
- [ ] 7.2 Seed a `CHANGELOG.md` so release-please appends to it
- [ ] 7.3 Add `.github/workflows/release-please.yml` using `googleapis/release-please-action` on pushes to `main` with `permissions: { contents: write, pull-requests: write }`
- [ ] 7.4 Document the Conventional Commits expectation in `CONTRIBUTING.md` (feat/fix/etc. and how they map to changelog entries)
- [ ] 7.5 Verify the release PR bumps the version + updates `CHANGELOG.md`, and that merging it creates the tag + GitHub Release and triggers `docker-publish.yml`

## 8. Funding & README polish

- [ ] 8.1 Add `.github/FUNDING.yml` with the maintainer's sponsor links
- [ ] 8.2 Add README badges: build/CI status, latest release, license, Docker image (GHCR), and a translation-status placeholder
- [ ] 8.3 Add a screenshot/feature section and tighten the quickstart for a first-time external user

## 9. Verification

- [ ] 9.1 `openspec validate open-source-release` passes
- [ ] 9.2 GitHub community-standards checklist shows license, contributing, conduct, security, and templates detected
- [ ] 9.3 Confirm a tagged release produces a multi-arch GHCR image and a GitHub Release with changelog notes
- [ ] 9.4 `GET /api/health` returns 200 `{ status: "ok", version }` from a running container

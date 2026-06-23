## Context

PosterPilot currently has no license, contribution docs, or CI. It uses Bun with `package.json` scripts `check` (svelte-check), `test` (vitest), and `format` (prettier). It already ships a multi-stage `Dockerfile` (adapter-node build, runtime image exposing port 3000) and a `docker-compose.yml`, but no published image — users must build locally. There is no automated changelog, versioning, or release process (`package.json` is pinned at `0.0.1`), and no health endpoint for orchestrators to probe. The release target is `github.com/diegopeixoto/posterpilot`, maintained by Diego Peixoto, and runs on both an arm64 Mac and an amd64 Unraid server. This change adds repository governance and release automation, plus one small additive `/api/health` route.

## Goals / Non-Goals

**Goals:**

- Make the repo safe and inviting to use and contribute to: clear license + copyright, contribution path, conduct and security policies, templates, and enforced quality gates.
- Reuse the existing Bun scripts as the single source of truth for CI checks.
- Give users a one-command path to run the app via an official, multi-arch container image they can pull, instead of building locally.
- Automate versioning, changelog, tags, and release notes from Conventional Commits so releases are low-effort and consistent.
- Provide a documented health endpoint so container orchestrators (Docker/Unraid) can probe liveness.

**Non-Goals:**

- No change to existing runtime behavior beyond adding the single `/api/health` route.
- No multi-maintainer governance model.
- No deep observability (metrics/readiness/dependency health). `/api/health` is a lightweight liveness + version probe only — it does not assert Plex/TMDB/DB reachability.
- No mandatory Docker Hub mirror; GHCR is canonical and Docker Hub is optional.

## Decisions

**1. MIT license.** Permissive, lowest-friction for a self-hosted tool; maximizes adoption and contribution. _Alternatives:_ Apache-2.0 (extra patent/NOTICE ceremony) or GPL-3.0 (copyleft deters some use) — rejected for this project's goals.

**2. CI mirrors local gates exactly.** The GitHub Actions workflow installs Bun, runs `bun install`, then `bun run check`, `bun run test`, and a prettier format check (`bun run format` in check mode / `lint`). Keeping CI identical to the documented local commands avoids drift between what contributors run and what CI enforces. _Alternative:_ a bespoke CI script (rejected — duplicates the scripts and drifts).

**3. Standard GitHub community files in conventional locations.** `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/FUNDING.yml`, and root-level `LICENSE` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md` so GitHub surfaces them automatically (Sponsor button, "New issue" chooser, community-standards checklist).

**4. Conduct = Contributor Covenant; Security = private reporting.** Use the widely-recognized Contributor Covenant for conduct and direct vulnerability reports to a private contact (GitHub private advisory / maintainer email) rather than public issues.

**5. Official image on GHCR, built multi-arch via `docker/build-push-action`.** A `docker-publish.yml` workflow triggers on release tags (and is reused by release-please's tag), logs into GHCR with the built-in `GITHUB_TOKEN`, sets up QEMU + Buildx, and builds `linux/amd64,linux/arm64` from the existing `Dockerfile`, pushing to `ghcr.io/diegopeixoto/posterpilot`. `docker/metadata-action` derives tags (`latest`, full semver, and major/minor aliases) and OCI labels. Multi-arch is required because the maintainer runs the image on an arm64 Mac and an amd64 Unraid host. _Alternatives:_ Docker Hub as the primary registry (rejected — GHCR ties cleanly to the repo, no extra account/secret, generous limits for public images); single-arch (rejected — would not run on both target hosts); a manual `docker buildx`/`docker push` step (rejected — `build-push-action` handles cache, attestations, and tagging). Docker Hub mirroring is left as an optional extra login + tag set behind a secret, off by default.

**6. Release automation via release-please (Conventional Commits).** Add `googleapis/release-please-action` (`release-type: node`, reading `package.json`) so merges of Conventional Commits to `main` maintain a single release PR that bumps the version, regenerates `CHANGELOG.md`, and — when merged — pushes the tag and creates a GitHub Release with generated notes. That release tag is what fires `docker-publish.yml`, keeping image versions and Git tags in lockstep. Config lives in `release-please-config.json` + `.release-please-manifest.json`. _Alternatives:_ `semantic-release` (rejected — heavier, publishes to npm by default, less aligned with the "PR you review then merge" model); `changesets` (rejected — designed for multi-package monorepos and manual changeset authoring); hand-written changelog (rejected — drifts and is easy to forget). This makes Conventional Commits a contribution expectation, documented in `CONTRIBUTING.md`.

**7. `/api/health` is a lightweight liveness + version probe.** A new `src/routes/api/health/+server.ts` exports `GET` returning `json({ status: 'ok', version })`, where `version` is read from the app's `package.json` (imported or via an env/`$app` constant). It is unauthenticated and does no I/O so it is fast and safe to call frequently and pre-config. The README documents it and `docker-compose.yml` gains an optional `healthcheck:` that curls it. _Alternatives:_ a full readiness check that pings Plex/TMDB/DB (rejected — turns a liveness probe into a slow, failure-prone dependency check and could leak config state); placing it at `/health` outside `/api` (rejected — `/api/health` keeps it consistent with the existing API route layout and SvelteKit `+server.ts` convention).

## Risks / Trade-offs

- **CI flakiness or Bun version drift** → Pin the Bun version in the workflow and use the format-check (non-writing) mode so CI is deterministic.
- **Format check failing on existing files** → Run `bun run format` once before enabling the gate so the baseline is clean.
- **License copyright holder accuracy** → Name "Diego Peixoto" and the current year in `LICENSE`, and mirror the notice in the README footer.
- **arm64 build is slow under QEMU emulation** → Use Buildx with GitHub Actions cache (`cache-from`/`cache-to: type=gha`) and only build images on release tags (not every push) to keep CI cost bounded.
- **GHCR push permissions** → Grant the workflow `packages: write` and `contents: read`; link the package to the repo and make it public so anonymous `docker pull` works.
- **release-please needs Conventional Commits** → Document the convention in `CONTRIBUTING.md`; non-conforming commits are simply omitted from the changelog rather than breaking the build. Seed `.release-please-manifest.json` with the current version so the first release PR is sane.
- **First release version** → `package.json` is `0.0.1`; decide the initial published version (e.g. `0.1.0`) and seed the manifest accordingly so release-please bumps from a deliberate baseline.
- **Health endpoint exposing data** → Keep `/api/health` to `{ status, version }` only; no config, secrets, or dependency state, so it is safe to expose unauthenticated.

## Migration Plan

1. Run `bun run format` to normalize the existing tree so the new format gate passes.
2. Add the community files, the `/api/health` route, and the CI workflow.
3. Add release automation: `release-please-config.json`, seed `.release-please-manifest.json` with the chosen baseline version, seed `CHANGELOG.md`, and add `release-please.yml`.
4. Add `docker-publish.yml` triggered on release tags; confirm the workflow has `packages: write`.
5. Push to the public repo; enable branch protection requiring the CI check (maintainer action on GitHub).
6. Cut the first release by merging the release-please PR; verify the GHCR image publishes for both architectures and `docker pull ghcr.io/diegopeixoto/posterpilot:latest` works.
7. Update the README with badges, the official-image pull instructions, the copyright footer, and `/api/health` docs.
8. Rollback: remove the workflow/config/community files and the `/api/health` route; only `/api/health` touches runtime and it is additive, so removing it is safe.

## Open Questions

- Funding platforms to list in `FUNDING.yml` (GitHub Sponsors, Ko-fi, etc.) — confirm with the maintainer.
- Security reporting channel: GitHub private vulnerability reporting vs a published email — confirm preference.
- Initial released version baseline for release-please (`0.1.0` vs `1.0.0`) — confirm with the maintainer.
- Whether to mirror images to Docker Hub in addition to GHCR (requires a Docker Hub account + `DOCKERHUB_TOKEN` secret) — default is GHCR-only.
- Translation-status badge source: which service backs the i18n badge (e.g. Weblate/Crowdin) — placeholder until the localization effort lands; the badge is a placeholder for now.

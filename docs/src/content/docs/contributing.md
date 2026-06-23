---
title: Contributing
description: Set up PosterPilot locally for development and run the quality gates that every change must pass before review.
---

Issues and pull requests are welcome. This page summarizes local setup and the
quality gates; the canonical, always-current source is
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md)
in the repository.

## Local setup

PosterPilot is a SvelteKit app that runs on [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env          # fill PLEX_URL / PLEX_TOKEN / TMDB_KEY (or use the Settings UI)
bun run db:generate           # generate SQL migrations from the Drizzle schema (already committed)
bun run dev                   # http://localhost:5173
```

Migrations apply automatically on server start.

## Quality gates

Every change must pass these before review — CI runs the same:

```sh
bun run check     # svelte-check type checking
bun run test      # vitest unit tests
bun run lint      # prettier --check (run `bun run format` to auto-fix)
```

The project follows test-driven development for server logic — write a failing
test first, then the implementation. Keep pure, testable logic free of
`$env` / `$app` imports so it can be unit-tested in isolation (see the existing
tests for the pattern).

## Commit messages

The project uses [Conventional Commits](https://www.conventionalcommits.org/). The
type prefix drives the automated changelog and version bump via release-please:

- `feat:` — a new feature (minor bump)
- `fix:` — a bug fix (patch bump)
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` — no release on their own
- `feat!:` / a `BREAKING CHANGE:` footer — major bump

Example: `feat(library): add genre filter`.

## Pull requests

1. Branch from `main`.
2. Make focused changes; keep the diff scoped to one concern.
3. Ensure `check`, `test`, and `lint` are green.
4. Open a PR using the template and link any related issue.

## Spec-driven changes

Larger features are planned with
[OpenSpec](https://github.com/Fission-AI/OpenSpec) under `openspec/changes/`. For a
substantial change, propose a spec first, then implement against its tasks. The
capability specs live under `openspec/specs/`.

## Translating

No coding is required to help translate the UI — see
[Translating](/posterpilot/translating/) for the Weblate workflow.

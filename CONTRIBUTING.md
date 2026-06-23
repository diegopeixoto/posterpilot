# Contributing to PosterPilot

Thanks for your interest in improving PosterPilot! This guide covers local setup,
the quality gates, and how to propose changes.

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

Every change must pass these before review (CI runs the same):

```sh
bun run check     # svelte-check type checking
bun run test      # vitest unit tests
bun run lint      # prettier --check (run `bun run format` to auto-fix)
```

We follow test-driven development for server logic — write a failing test first,
then the implementation. Keep pure, testable logic free of `$env`/`$app` imports
so it can be unit-tested in isolation (see existing tests for the pattern).

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). The type
prefix drives the automated changelog and version bump via release-please:

- `feat:` — a new feature (minor bump)
- `fix:` — a bug fix (patch bump)
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` — no release on their own
- `feat!:` / a `BREAKING CHANGE:` footer — major bump

Example: `feat(library): add genre filter`.

## Pull requests

1. Branch from `main`.
2. Make focused changes; keep the diff scoped to one concern.
3. Ensure `check`, `test`, and `lint` are green.
4. Open a PR using the template; link any related issue.

## Spec-driven changes

Larger features are planned with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
under `openspec/changes/`. For a substantial change, propose a spec first
(`openspec`), then implement against its tasks.

## Translations

Help translate the UI! Translation catalogs live in `messages/<locale>.json` and
are managed through Weblate — see [docs on translating](README.md#translating).
You can also edit the catalogs directly and open a PR.

By contributing, you agree your contributions are licensed under the project's
[MIT license](LICENSE).

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

## Translators

Help translate the UI into your language! No coding required.

**Source of truth.** Every user-facing string lives in a per-locale JSON catalog
under `messages/` — one file per language (`messages/en.json`, `es.json`,
`zh.json`, `ja.json`, `pt-BR.json`, `fr.json`), keyed by a stable message id. English
(`messages/en.json`) is the complete **source** catalog; the others hold
translations and may be partial. Any id missing or left empty in a target locale
falls back to its English text, so a partial translation never shows a raw key.

**Via Weblate (recommended).** Translations are managed through
[Weblate](https://hosted.weblate.org/engage/posterpilot/), a libre web translation
platform:

1. Open the [PosterPilot project on Weblate](https://hosted.weblate.org/engage/posterpilot/)
   and sign in (a free account works).
2. Pick your language and translate the untranslated strings in the browser.
3. Weblate proposes the changes back to this repository as commits/PRs over git —
   a maintainer merges them. New English strings added to `en.json` automatically
   surface as untranslated entries for every language.

**Via a direct PR.** You can also edit a catalog by hand: copy a new key from
`messages/en.json` into `messages/<locale>.json`, translate the value, and open a
PR. Keep keys identical to the source; only translate the values. Leave technical
proper nouns (Plex, MediUX, TMDB, Kometa, Fanart.tv) untranslated.

The Weblate component is configured against `messages/*.json` with `en` as the
source language and JSON (key-value) format; the README shows a per-language
translation-status badge.

By contributing, you agree your contributions are licensed under the project's
[MIT license](LICENSE).

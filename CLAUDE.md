# PosterPilot

Self-hosted poster/artwork manager for Plex, Jellyfin & Emby. Browses one media server,
resolves titles to TMDB, finds covers across providers (MediUX, Fanart.tv, TMDB,
ThePosterDB), and applies them directly to the server and/or exports Kometa YAML.

Stack: SvelteKit + Svelte 5 (runes), Bun, adapter-node, Drizzle ORM + libsql (SQLite),
Tailwind v4 (`@theme` tokens + `@layer components` in `src/app.css`), Paraglide JS i18n
(en/es/zh/ja/pt-BR/fr), Astro Starlight docs under `docs/`.

## Working conventions

- **New work on a branch + PR** — never push directly to `main`. Self-review the diff
  before handing it over; leave the merge to the maintainer.
- **Conventional Commits** (`feat:`/`fix:`/`ci:`/`chore:`/`docs:`…) — release-please keys
  version bumps and CHANGELOG off them.
- **Squash-merge only** (merge and rebase merges are disabled on the repo) — `main` gets one
  commit per PR titled after the PR, so the CHANGELOG carries one PR-linked line per change
  instead of every intermediate commit. Keep no `type: description` lines in a PR body;
  release-please reads them as extra changelog entries.
- **Release notes are curated, not generated** — release-please owns the version, tag, and
  raw ledger; the `release-notes` skill rewrites that into user-facing notes: the release PR
  _body_ before merge (it becomes the GitHub Release), `CHANGELOG.md` in a follow-up PR after
  the tag. Run it after the last merge — release-please force-pushes the release branch on
  every push to `main`.
- **Never commit to the release-please branch** — merging a release PR that carries extra
  commits bumps the manifest but emits `release_created: false`, so no tag, no release, and
  no Docker image; re-running does not fix it. The PR _body_ is safe to edit. Recovery steps
  are in the `release-notes` skill.
- **No Claude trailers** in commits (no `Co-Authored-By: Claude`, no `Claude-Session:`).
  Commits are authored under the maintainer's git identity.
- **Quality gates before a PR is ready:** `bun run check` (0 errors), `bun run test`,
  `bun run build`, `bun run lint`. `check` compiles Paraglide first; the generated
  `src/lib/paraglide/` is git-ignored.
- **Three test layers.** `bun run test` runs the first two; CI runs check/test/lint, so
  build and e2e are local-only gates.
  - **unit** (`test:unit`) — pure logic in plain node. Keep these `$env`-free.
  - **component** (`test:component`) — `*.svelte.test.ts` rendered in real Chromium via
    `vitest-browser-svelte`, with `app.css` loaded so computed style is assertable. Use
    this for focus, `activeElement`, live regions, pointer capture, and DOM order after a
    keyed re-render — an emulated DOM models exactly those least faithfully. Components
    under test must import only `svelte` and `$lib/*`; anything reaching for `$app/*`
    belongs in E2E.
  - **e2e** (`test:e2e`, Playwright) — whole flows against a built app.
- **Extract logic that a component test cannot reach** into a pure module and unit-test it,
  rather than leaving it untested inside a `.svelte` file.
- **Before push:** `bun run fallow` — apply only unambiguous dead-code fixes.
- **Signed commits required on `main`** — ruleset rejects unsigned; rebase-sign
  contributor branches, verify `git log --format=%G?` = `G`.
- **AGENTS.md mirrors this file** — update both together (it already drifted once).
- **i18n:** add keys to every `messages/*.json` catalog; keep the 6 languages at parity.
- **Tests stay `$env`-free:** extract pure functions into their own modules and test those.

## Design Context

Read [`.impeccable.md`](./.impeccable.md) before any design work — it's the **canonical**
design context (users, brand personality, aesthetic direction, accessibility, and the 5
design principles). Actual token/component values live in `src/app.css`.

The one-line version: **sleek & cinematic, dark by default, a single violet accent,
MediUX image-forward** — explicitly _not_ gamer/RGB, toy-like, or corporate-SaaS — held
to **WCAG AA** with `prefers-reduced-motion` honored. The default look is governed by
these principles; users can opt into other themes via the theme-kit engine
(`src/lib/theming/` + `[data-theme]` blocks in `src/app.css`), where components must
consume the semantic `--pp-*` tokens (`bg-surface`, `text-text-muted`, …) instead of
hard-coded `neutral-*`/`accent-*` utilities.

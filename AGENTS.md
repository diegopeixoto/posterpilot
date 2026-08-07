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
  raw ledger; `.claude/skills/release-notes/SKILL.md` documents how that becomes user-facing
  notes in both `CHANGELOG.md` and the release PR body *before* the release PR merges. Run it
  after the last merge — release-please force-pushes the release branch on every push to `main`.
- **No Codex trailers** in commits (no `Co-Authored-By: Codex`, no `Codex-Session:`).
  Commits are authored under the maintainer's git identity.
- **Quality gates before a PR is ready:** `bun run check` (0 errors), `bun run test`,
  `bun run build`, `bun run lint`. `check` compiles Paraglide first; the generated
  `src/lib/paraglide/` is git-ignored.
- **E2E:** `bun run test:e2e` (Playwright) for browser-flow changes — CI runs only
  check/test/lint, so build and e2e are local-only gates.
- **Before push:** `bun run fallow` — apply only unambiguous dead-code fixes.
- **Signed commits required on `main`** — ruleset rejects unsigned; rebase-sign
  contributor branches, verify `git log --format=%G?` = `G`.
- **This file mirrors CLAUDE.md** — update both together (it already drifted once).
- **i18n:** add keys to every `messages/*.json` catalog; keep the 6 languages at parity.
- **Tests stay `$env`-free:** extract pure functions into their own modules and test those.

## Design Context

Read [`.impeccable.md`](./.impeccable.md) before any design work — it's the **canonical**
design context (users, brand personality, aesthetic direction, accessibility, and the 5
design principles). Actual token/component values live in `src/app.css`.

The one-line version: **sleek & cinematic, dark-only, a single violet accent, MediUX
image-forward** — explicitly _not_ gamer/RGB, toy-like, or corporate-SaaS — held to
**WCAG AA** with `prefers-reduced-motion` honored.

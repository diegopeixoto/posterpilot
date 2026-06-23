# PosterPilot

Self-hosted poster/artwork manager for Plex, Jellyfin & Emby. Browses one media server,
resolves titles to TMDB, finds covers across providers (MediUX, Fanart.tv, TMDB,
ThePosterDB), and applies them directly to the server and/or exports Kometa YAML.

Stack: SvelteKit + Svelte 5 (runes), Bun, adapter-node, Drizzle ORM + libsql (SQLite),
Tailwind v4 (`@theme` tokens + `@layer components` in `src/app.css`), Paraglide JS i18n
(en/es/zh/ja/pt-BR), Astro Starlight docs under `docs/`.

## Working conventions

- **New work on a branch + PR** — never push directly to `main`. Self-review the diff
  before handing it over; leave the merge to the maintainer.
- **Conventional Commits** (`feat:`/`fix:`/`ci:`/`chore:`/`docs:`…) — release-please keys
  version bumps and CHANGELOG off them.
- **No Claude trailers** in commits (no `Co-Authored-By: Claude`, no `Claude-Session:`).
  Commits are authored under the maintainer's git identity.
- **Quality gates before a PR is ready:** `bun run check` (0 errors), `bun run test`,
  `bun run build`, `bun run lint`. `check` compiles Paraglide first; the generated
  `src/lib/paraglide/` is git-ignored.
- **i18n:** add keys to every `messages/*.json` catalog; keep the 5 languages at parity.
- **Tests stay `$env`-free:** extract pure functions into their own modules and test those.

## Design Context

Read [`.impeccable.md`](./.impeccable.md) before any design work — it's the **canonical**
design context (users, brand personality, aesthetic direction, accessibility, and the 5
design principles). Actual token/component values live in `src/app.css`.

The one-line version: **sleek & cinematic, dark-only, a single violet accent, MediUX
image-forward** — explicitly _not_ gamer/RGB, toy-like, or corporate-SaaS — held to
**WCAG AA** with `prefers-reduced-motion` honored.

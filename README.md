# posterpilot

[![CI](https://github.com/diegopeixoto/posterpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/diegopeixoto/posterpilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/diegopeixoto/posterpilot?sort=semver)](https://github.com/diegopeixoto/posterpilot/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Container](https://img.shields.io/badge/ghcr.io-posterpilot-2496ED?logo=docker&logoColor=white)](https://github.com/diegopeixoto/posterpilot/pkgs/container/posterpilot)
[![Documentation](https://img.shields.io/badge/docs-posterpilot-4F46E5?logo=astro&logoColor=white)](https://diegopeixoto.github.io/posterpilot)
[![Translation status](https://hosted.weblate.org/widget/posterpilot/svg-badge.svg)](https://hosted.weblate.org/engage/posterpilot/)

Self-hosted web app to browse a Plex library, find artwork covers on
[mediux.pro](https://mediux.pro), and apply the chosen cover to Plex — directly
via the Plex API and/or by exporting Kometa/PMM-compatible YAML. Runs as a single
Docker container on a Mac and on an Unraid server.

> Spec-driven via [OpenSpec](https://github.com/Fission-AI/OpenSpec). See
> `openspec/specs/` for the capability specs and `openspec/changes/` for in-flight
> proposals.

📖 **Documentation:** full installation, configuration, usage, contributing, and
translating guides live at
**[diegopeixoto.github.io/posterpilot](https://diegopeixoto.github.io/posterpilot)**.

## What it does

1. **Sync** your Plex movie/show libraries and resolve each title to a TMDB id.
2. **Find covers** for a title on mediux.pro (poster/background candidates).
3. **Apply** a chosen cover, two ways (selectable):
   - **Plex API** — uploads the poster and locks the field, instantly.
   - **Kometa export** — writes `url_poster`/`url_background` YAML into a mounted
     directory your existing Kometa instance consumes on its next run.

Library-wide work runs as background jobs with live progress (SSE).

## Stack

- **SvelteKit** (TypeScript) on **Bun**, built with `adapter-node` (run under Bun)
- **SQLite + Drizzle ORM** (libsql) — library cache, candidates, history, jobs, settings
- **Tailwind CSS v4**, dark image-forward UI
- In-process job queue + **Server-Sent Events** for live progress

## Develop

```sh
bun install
cp .env.example .env          # fill PLEX_URL / PLEX_TOKEN / TMDB_KEY (or use the Settings UI)
bun run db:generate           # generate SQL migrations from the Drizzle schema (already committed)
bun run dev                   # http://localhost:5173
```

Migrations are applied automatically on server startup. Useful scripts:

| script                    | purpose                                |
| ------------------------- | -------------------------------------- |
| `bun run dev`             | dev server                             |
| `bun run build`           | production build (adapter-node)        |
| `bun run start`           | run the built server (`node build`)    |
| `bun run check`           | svelte-check type checking             |
| `bun run test`            | vitest unit tests                      |
| `bun run format` / `lint` | prettier write / check                 |
| `bun run fallow`          | Fallow code-intelligence health report |

## Run with Docker (Mac and Unraid)

The same image runs anywhere. Use the **official multi-arch image** (amd64 + arm64)
from GitHub Container Registry:

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

Then point `docker-compose.yml` at `image: ghcr.io/diegopeixoto/posterpilot:latest`
(instead of `build: .`) and start it:

```sh
docker compose up -d
# UI at http://localhost:3000
```

Or build locally instead:

```sh
docker compose up -d --build
```

Configuration is via environment variables (or the in-app **Settings** page):

| var                 | meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `PLEX_URL`          | e.g. `http://192.168.1.10:32400`                                |
| `PLEX_TOKEN`        | your `X-Plex-Token`                                             |
| `TMDB_KEY`          | TMDB v3 API key **or** v4 bearer/JWT (auto-detected)            |
| `DATABASE_URL`      | libsql file URL (default `file:/data/posterpilot.db` in Docker) |
| `KOMETA_ASSETS_DIR` | where exported Kometa YAML is written (default `/kometa`)       |
| `PORT`              | listen port (default `3000`)                                    |

Two volumes matter:

- **`/data`** — persistent SQLite db, settings, and history. Keep this on a
  mounted volume so state survives container updates.
- **`/kometa`** — mount your Kometa assets/config directory here so the exported
  YAML lands where Kometa reads it.

### Unraid

Point the Kometa volume at your existing Kometa config, e.g. in
`docker-compose.yml`:

```yaml
volumes:
  - /mnt/user/appdata/posterpilot:/data
  - /mnt/user/appdata/kometa/config:/kometa
```

Set `PLEX_URL`/`PLEX_TOKEN`/`TMDB_KEY` in the container's environment (or leave
them blank and configure via the Settings page), then browse to the container on
port 3000.

## How Kometa consumes the export

posterpilot writes a single metadata file (default `posterpilot.yml`) into
`KOMETA_ASSETS_DIR`, keyed by TMDB id with `url_poster` / `url_background`
entries — the same shape the legacy scraper produced. Add that file to your
Kometa library config (e.g. under `metadata_path`/`metadata_files`) so Kometa
applies the covers on its next run. Re-applying updates entries in place.

## Health check

The app exposes an unauthenticated `GET /api/health` that returns
`{ "status": "ok", "version": "x.y.z" }` with HTTP 200 — use it as a container
health probe (the bundled `docker-compose.yml` already does):

```sh
curl -s http://localhost:3000/api/health
```

## Translating

The UI is localized into English (default), Spanish, Simplified Chinese,
Japanese, and Brazilian Portuguese, with per-key English fallback so an
untranslated string always shows readable English, never a raw key. The active
language is resolved per request from your persisted preference (set via the
header switcher or Settings), then your browser's `Accept-Language`, then
English.

[![Translation status](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

Translations live as one JSON catalog per locale under `messages/` (e.g.
`messages/es.json`), with `messages/en.json` as the complete source. They are
managed through [Weblate](https://hosted.weblate.org/engage/posterpilot/) — join
the project to translate in your browser; completed strings land back in the repo
via git. New English strings added to `en.json` automatically appear as
untranslated entries for every language. You can also edit a catalog directly and
open a PR. See [CONTRIBUTING.md](CONTRIBUTING.md#translators) for the full
workflow.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the
quality gates, and the Conventional Commits convention. Translations are managed
through Weblate; you can also edit `messages/<locale>.json` and open a PR. Please
follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues per the
[Security Policy](SECURITY.md).

## Reference

Scraping behavior is ported from the legacy Python tool `mediux-scraper-monorepo`
(reference only — no Python code is reused).

## License

Released under the [MIT License](LICENSE).

---

Copyright (c) 2026 Diego Peixoto — MIT licensed.

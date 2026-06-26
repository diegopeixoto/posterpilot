---
title: Installation
description: Run PosterPilot as a single Docker container using the official GHCR image, with Docker Compose examples for macOS and Unraid.
---

PosterPilot runs as a single Docker container. The same multi-arch image
(`amd64` + `arm64`) runs on a Mac, an Unraid server, or anywhere else Docker
runs.

## The official image

The official prebuilt image is published to the GitHub Container Registry:

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

Tags follow the releases; `:latest` tracks the most recent release. You can pin a
specific version tag instead if you prefer reproducible upgrades.

## Volumes and ports

The volumes that matter:

- **`/data`** — persistent app state: the SQLite database, your saved settings,
  the apply history, and the rotating log file (`/data/logs/posterpilot.log`).
  Keep this on a mounted volume so state survives container updates; the log file
  lives inside `/data`, so no extra volume is needed for it.
- **`/kometa`** — mount your Kometa assets/config directory here so the exported
  YAML lands where Kometa reads it. Only needed if you use the Kometa export.
- **Kometa's config dir** _(optional)_ — to manage Kometa's own `config.yml` with
  the [Kometa manager](/posterpilot/kometa-config-sync/), mount that directory
  **read/write** and point `KOMETA_CONFIG_PATH` at the `config.yml` inside it
  (e.g. `/config/config.yml`). PosterPilot writes `posterpilot.yml` into that same
  directory, so this one mount is all the manager needs. See
  [Mount Kometa's config for config sync](#mount-kometas-config-for-config-sync).

The container listens on port **3000** by default (configurable via the `PORT`
environment variable). Publish it to a host port to reach the UI.

## Mount Kometa's config for config sync

The [Kometa manager](/posterpilot/kometa-config-sync/) lets PosterPilot manage
Kometa's own `config.yml`. To use it, that file has to be reachable and writable
from inside the PosterPilot container:

1. **Mount Kometa's config directory read/write.** Bind-mount the host directory
   that holds Kometa's `config.yml` into the container — for example at `/config`.
   Bind mounts are read/write by default; do not mark it `:ro`, because the
   manager writes the file and leaves a timestamped backup beside it.
2. **Point `KOMETA_CONFIG_PATH` at the mounted file** — e.g. `/config/config.yml`.
   Leaving it unset keeps the Kometa manager off.

That single directory is all the manager needs: PosterPilot writes
`posterpilot.yml` into the **same directory as `config.yml`** (co-located) and
wires it into `config.yml` by its bare basename, so there is no separate metadata
path or mount to configure. This is in addition to the existing `/data` volume and
the `/kometa` Kometa assets mount. If your Kometa install keeps `config.yml` and
the assets folder in the same directory, you can mount that one directory and point
both `KOMETA_ASSETS_DIR` and `KOMETA_CONFIG_PATH` at it.

:::caution
Kometa reads the Plex token and TMDB key from `config.yml` in plaintext, so the
manager writes those secrets into the file (and its backups) on the mounted volume.
Keep that storage trusted and permissioned. See
[Kometa manager](/posterpilot/kometa-config-sync/#safety) for the full behavior.
:::

## Docker Compose (macOS)

Create a `docker-compose.yml`:

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    healthcheck:
      test:
        [
          'CMD',
          'bun',
          '-e',
          "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Optional — you can also set these in the in-app Settings page instead:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
      # Optional — manage Kometa's own config.yml (Kometa manager):
      # KOMETA_CONFIG_PATH: /config/config.yml
    volumes:
      # Persistent app state (SQLite db + settings + history).
      - ./data:/data
      # Mount your Kometa assets/config dir here so exported YAML is picked up.
      - ./data/kometa:/kometa
      # Optional — Kometa's config dir (read/write) for the Kometa manager.
      # - ./data/kometa/config:/config
    restart: unless-stopped
```

Then start it:

```sh
docker compose up -d
# UI at http://localhost:3000
```

The bundled `docker-compose.yml` in the repository is the same shape and includes
a `build: .` option if you would rather build the image locally instead of
pulling it:

```sh
docker compose up -d --build
```

## Unraid (Community Apps template)

The repository ships a Community Apps template at `unraid/posterpilot.xml`. In the
Unraid UI go to **Docker → Add Container** and paste this into the _Template_ field:

```
https://raw.githubusercontent.com/diegopeixoto/posterpilot/main/unraid/posterpilot.xml
```

It pre-fills the GHCR image, the WebUI port, the `/data` and `/kometa` volumes, and
optional credential fields (Plex / Jellyfin / Emby, TMDB, Fanart.tv, language) —
all of which you can also configure later in the Settings page.

To also use the [Kometa manager](/posterpilot/kometa-config-sync/), add a path
mapping for Kometa's config directory (read/write) and set `KOMETA_CONFIG_PATH` to
the mounted `config.yml` — the same extra mount shown in the Compose examples
below.

## Docker Compose (Unraid)

Prefer Compose? Point the volumes at your `appdata` share — in particular, point the
Kometa volume at your **existing** Kometa config directory so exported YAML lands
where Kometa already reads it:

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Optional — or configure these in the Settings page:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
      # Optional — manage Kometa's own config.yml (Kometa manager):
      # KOMETA_CONFIG_PATH: /config/config.yml
    volumes:
      - /mnt/user/appdata/posterpilot:/data
      - /mnt/user/appdata/kometa/config:/kometa
      # Optional — Kometa's config dir (read/write) for the Kometa manager.
      # - /mnt/user/appdata/kometa/config:/config
    restart: unless-stopped
```

Set `PLEX_URL` / `PLEX_TOKEN` / `TMDB_KEY` in the container's environment, or leave
them blank and configure everything via the Settings page, then browse to the
container on port 3000.

## First run

1. Start the container and open `http://<host>:3000` (e.g.
   `http://localhost:3000`).
2. On first run nothing is synced yet. A banner points you at the **first-install
   wizard** at `/setup`, which walks you through six steps: choose a language,
   connect a media server, add a TMDB key, enable artwork providers, pick which
   libraries to sync, and run the first sync. For Plex the wizard includes a PIN
   login and connection discovery so you never have to paste a token or URL. The
   wizard is skippable — you can configure everything in **Settings** instead.
3. If you set credentials via environment variables, they appear already
   configured and locked from editing in both the wizard and Settings (see
   [Configuration](/posterpilot/configuration/)).
4. Once synced, start finding and applying covers (see
   [Usage](/posterpilot/usage/)).

## Health check

The app exposes an unauthenticated `GET /api/health` that returns
`{ "status": "ok", "version": "x.y.z" }` with HTTP 200 — use it as a container
health probe (the bundled `docker-compose.yml` already does):

```sh
curl -s http://localhost:3000/api/health
```

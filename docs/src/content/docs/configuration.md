---
title: Configuration
description: Connect a media server, set your TMDB key, enable artwork providers, configure the Kometa export, and use the full environment-variable reference.
---

PosterPilot is configured two ways, and they work together:

- **Environment variables** — set on the container. Good for unattended setups
  and secret management.
- **The in-app Settings page** — entered in the UI and persisted to the SQLite
  database under `/data` so they survive restarts. Settings is organized into
  tabs: **Media server**, **Metadata & providers**, **Kometa & advanced**,
  **Language**, and **Activity** (the in-app event log). A guided
  [first-install wizard](/posterpilot/installation/#first-run) at `/setup` covers
  the same ground in order for a fresh install.

## Environment vs. the Settings UI

For any given setting, the **environment variable always takes precedence** over
the persisted UI value. When a value is supplied via the environment, the
Settings page shows it as _environment-managed_ and locks it from editing in the
UI — so the source of truth is unambiguous.

If a value is set in neither place, the documented default (if any) applies, or
the feature that depends on it stays unconfigured until you set it.

Secrets (the Plex token, the Jellyfin/Emby API keys, the TMDB credential, and the
Fanart.tv key) are never echoed back to the browser after they are saved and are
redacted from logs — the Settings page only indicates that a secret _is set_.

## Media server

PosterPilot talks to one active media server at a time, chosen by `SERVER_TYPE`
(`plex`, `jellyfin`, or `emby`; defaults to `plex`). Only the active server's
credentials are validated before a sync.

### Plex

Plex needs a base URL and an `X-Plex-Token`. You can supply them three ways:

- **PIN login (recommended).** In Settings, start a Plex login. PosterPilot
  creates a strong PIN with plex.tv, shows you a code and an authorization link,
  and polls until you authorize it — then it stores the acquired token for you, so
  you never have to find and paste a raw token. If the PIN expires before you
  authorize, just start a new login.
- **Connection discovery.** Once a token is available, PosterPilot can discover
  your Plex servers and their connections from plex.tv, labelling each connection
  **local** or **remote** (relays are flagged). Pick one instead of typing a URL;
  the chosen connection is verified with a connection test before it is saved as
  the active Plex base URL.
- **Manual.** Paste the base URL (e.g. `http://192.168.1.10:32400`) and an
  `X-Plex-Token` directly.

### Jellyfin

Jellyfin needs a base URL (`JELLYFIN_URL`) and an API key (`JELLYFIN_API_KEY`).
Set `SERVER_TYPE=jellyfin` to make it the active server. Posters and backgrounds
are uploaded to the Jellyfin image API (`Primary` for poster, `Backdrop` for
background). There is no PIN login or connection discovery for Jellyfin — supply
the URL and API key directly.

:::note
The Plex path is the most battle-tested; the Jellyfin and Emby integrations are
newer. They run behind the same media-server interface, so sync, discover, and
apply work identically — but if you hit a server-specific quirk, please file an
issue.
:::

### Emby

Emby needs a base URL (`EMBY_URL`) and an API key (`EMBY_API_KEY`). Set
`SERVER_TYPE=emby` to make it the active server. Like Jellyfin, Emby uses a URL +
API key directly (no PIN login or connection discovery).

## TMDB key

A [TMDB](https://www.themoviedb.org/) API credential is required: PosterPilot
resolves each synced title to a TMDB id (so providers can be queried accurately)
and TMDB is also one of the artwork providers. Set it via `TMDB_KEY` or in
Settings. Both a **v3 API key** and a **v4 bearer/JWT token** are accepted — the
format is auto-detected.

## Artwork providers

PosterPilot fans out across multiple artwork providers during discovery and
merges their candidates, tagging each with the provider it came from. Each
provider can be enabled or disabled independently, in Settings or via its
environment variable.

| Provider        | Default | Needs a key       | Notes                                                           |
| --------------- | ------- | ----------------- | --------------------------------------------------------------- |
| **MediUX**      | on      | no                | Scraped poster/background sets with uploader attribution.       |
| **TMDB**        | on      | reuses `TMDB_KEY` | Posters and backdrops from the TMDB images endpoint.            |
| **Fanart.tv**   | off     | `FANART_KEY`      | Posters, backgrounds, and logos from the Fanart.tv API.         |
| **ThePosterDB** | off     | no                | Scraped community poster/background sets, throttled and cached. |

Fanart.tv is the only keyed provider: if it is enabled but no `FANART_KEY` is
configured, discovery skips it and surfaces the missing-credential condition
rather than failing the whole run. A failure, timeout, or unparseable response
from one provider never prevents the others from returning candidates.

## Kometa export

When you apply a cover with the Kometa method, PosterPilot writes
Kometa/PMM-compatible YAML (`url_poster` / `url_background`, keyed by TMDB id) into
the directory named by `KOMETA_ASSETS_DIR` (default `/kometa` in Docker). Mount
that path at your existing Kometa config directory so Kometa applies the covers on
its next run. See [Usage](/posterpilot/usage/#apply-a-cover) for how the export is
consumed.

## Language

The UI language is resolved per request: (1) the preferred-language setting when
it names a supported locale, then (2) the request's `Accept-Language` header, then
(3) English. Set a preferred language with `LANGUAGE`, via the Settings page, or
with the header language switcher. Supported locales are English (`en`), Spanish
(`es`), Simplified Chinese (`zh`), Japanese (`ja`), and Brazilian Portuguese
(`pt-BR`). An unset or unsupported value falls through to `Accept-Language`, then
English — never an error and never a raw key.

## Logging and activity log

Every operational event is recorded three ways: mirrored to the container
console, inserted as a row in the in-app **Activity** log (Settings → Activity),
and appended to a rotating log file. The file is `posterpilot.log` inside
`LOG_DIR` (default `/data/logs` in Docker); when it grows past ~5 MB it rotates
(`posterpilot.log` → `.1` → `.2` …), keeping about five files. Because the
default lives under `/data`, the existing `/data` volume already persists it — no
extra mount is required.

The Activity log table is capped at `EVENT_RETENTION` rows (default `2000`);
older rows are pruned automatically. You can wipe the table at any time with the
**Clear activity** button on the Activity tab (this does not delete the on-disk
log file).

## Environment-variable reference

Every setting below can be supplied as an environment variable. Most are also
editable in the Settings page; when set via the environment they take precedence
and are locked in the UI.

| Variable                  | Setting                   | Default                               | Meaning                                                                                       |
| ------------------------- | ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SERVER_TYPE`             | Server type               | `plex`                                | Active media server: `plex`, `jellyfin`, or `emby`.                                           |
| `PLEX_URL`                | Plex URL                  | —                                     | Plex base URL, e.g. `http://192.168.1.10:32400`.                                              |
| `PLEX_TOKEN`              | Plex token (secret)       | —                                     | Your `X-Plex-Token`.                                                                          |
| `PLEX_CLIENT_ID`          | Plex client id            | generated                             | Stable per-install identifier sent to plex.tv for PIN login / discovery.                      |
| `JELLYFIN_URL`            | Jellyfin URL              | —                                     | Jellyfin base URL (when `SERVER_TYPE=jellyfin`).                                              |
| `JELLYFIN_API_KEY`        | Jellyfin API key (secret) | —                                     | Jellyfin API key.                                                                             |
| `EMBY_URL`                | Emby URL                  | —                                     | Emby base URL (when `SERVER_TYPE=emby`).                                                      |
| `EMBY_API_KEY`            | Emby API key (secret)     | —                                     | Emby API key.                                                                                 |
| `TMDB_KEY`                | TMDB key (secret)         | —                                     | TMDB v3 API key **or** v4 bearer/JWT (auto-detected).                                         |
| `KOMETA_ASSETS_DIR`       | Kometa assets dir         | `./data/kometa` (`/kometa` in Docker) | Directory the exported Kometa YAML is written to.                                             |
| `DEFAULT_APPLY_METHOD`    | Default apply method      | `both`                                | Default apply method: `plex`, `kometa`, or `both`.                                            |
| `INCLUDED_SECTIONS`       | Included sections         | all movie/show                        | Library section keys to sync; comma-separated (env) or a JSON array (persisted). Empty = all. |
| `PROVIDER_MEDIUX`         | MediUX provider           | on                                    | Enable the MediUX provider.                                                                   |
| `PROVIDER_TMDB`           | TMDB provider             | on                                    | Enable the TMDB-artwork provider.                                                             |
| `PROVIDER_FANART`         | Fanart.tv provider        | off                                   | Enable the Fanart.tv provider (requires `FANART_KEY`).                                        |
| `PROVIDER_THEPOSTERDB`    | ThePosterDB provider      | off                                   | Enable the ThePosterDB provider.                                                              |
| `FANART_KEY`              | Fanart.tv key (secret)    | —                                     | Fanart.tv API key (the only keyed provider).                                                  |
| `MEDIUX_REQUEST_DELAY_MS` | MediUX request delay      | `2000`                                | Delay between MediUX requests, in milliseconds (throttling).                                  |
| `MEDIUX_CONCURRENCY`      | MediUX concurrency        | `5`                                   | Max concurrent MediUX requests.                                                               |
| `HTTP_CACHE_TTL_DAYS`     | HTTP cache TTL            | `7`                                   | How long cached HTTP responses (scrapes) are reused, in days.                                 |
| `LANGUAGE`                | Language                  | — (auto)                              | Preferred UI locale: `en`, `es`, `zh`, `ja`, or `pt-BR`.                                      |
| `LOG_DIR`                 | —                         | `/data/logs` (Docker)                 | Folder for the rotating `posterpilot.log` file (~5 MB × 5 files).                             |
| `EVENT_RETENTION`         | —                         | `2000`                                | Max number of activity-log rows kept in the database (older rows are pruned).                 |
| `DATABASE_URL`            | —                         | `file:/data/posterpilot.db` (Docker)  | libsql file URL for the SQLite database.                                                      |
| `PORT`                    | —                         | `3000`                                | Listen port.                                                                                  |

Boolean flags accept `1` / `true` / `on` / `yes` (case-insensitive) for _enabled_;
anything else (or unset) leaves the documented default.

:::note
`DATABASE_URL`, `PORT`, `LOG_DIR`, and `EVENT_RETENTION` are deployment-level
settings — they are read from the environment only and are not part of the in-app
Settings page.
:::

## Why

PosterPilot has **no authentication**: anyone who can reach the port can change settings, apply
artwork, and upload files, and the app stores media-server tokens and provider keys. That is the
largest exposure in an otherwise healthy codebase. We close it the **\*arr way** (Sonarr/Radarr) —
optional auth with a local-network bypass — so self-hosters keep the zero-friction LAN experience by
default but can lock the instance down when they expose it. We ship it in one focused PR alongside a
delimited set of security/perf hardening that is cheap to land in the same pass; everything else
from the project diagnosis stays as follow-ups.

## What Changes

- **Optional \*arr-style authentication.** A new `authMode` of `disabled` (default) | `enabled` |
  `local` (enabled except for local addresses). Form login (username + password), a signed
  stateless session cookie, and a route guard in `hooks.server.ts`. Credentials and sessions are
  stored/derived without a schema migration or new env surface.
- **No lockout, ever.** `AUTH_MODE` env var overrides the persisted mode (an operator can always
  recover a locked instance), and a fail-open guard drops to `disabled` if the mode is on but
  credentials are missing.
- **Validated uploads.** The custom-poster upload endpoint validates the file by **magic bytes**
  (allow-list: jpeg/png/webp) and a **size cap**, rejecting spoofed or oversized files before apply.
- **Politer outbound HTTP.** The shared fetch retry honors an upstream **`Retry-After`** header on
  429/503 instead of only exponential backoff.
- **Hardened container + CI (non-breaking).** The Docker image gets a **pinned** base and a
  **HEALTHCHECK**, and CI runs `docker build`. The container keeps running as root (status quo) — none
  of this changes the container user or volume ownership, so there is no ops migration. (Running
  non-root is intentionally left to its own future PR.)
- **Faster page loads.** Independent per-request queries that currently run serially are
  parallelized (internal perf; no behavior change).
- **[Extra] Security response headers** on every response: `X-Content-Type-Options: nosniff`,
  clickjacking protection (`X-Frame-Options`/`frame-ancestors`), `Referrer-Policy`,
  `X-Robots-Tag: noindex` (this is a private app), and `Strict-Transport-Security` on HTTPS only.
- **[Extra] Secret-key-file permission guard.** At boot, warn loudly if `.app-key` is group- or
  world-readable — cheap hygiene for the key that protects every stored secret.
- **[Extra] Auth event logging.** Structured log lines on login success / failure / lockout and on
  credential changes, never logging the password.

**Out of scope (follow-ups):** library pagination/virtualization, wall thumbnails via `/api/thumb`,
toasts/skeletons/keyboard nav, decomposing monolithic pages, unifying duplicated Plex code, ESLint,
`kometa/sync` tests, docs screenshots.

## Capabilities

### New Capabilities
- `authentication`: optional \*arr-style auth — `disabled`/`enabled`/`local` modes, password hashing
  (async scrypt, pure module), signed stateless session cookie with sliding expiry and
  version-based invalidation, route guard with public allow-list and JSON-401 vs redirect handling,
  local-address detection with **fail-closed** proxy handling, in-memory login throttle, a
  first-enable flow that keeps the enabling user logged in, logout, and auth event logging.
- `security-headers`: baseline hardening headers applied to every HTTP response (content-type
  nosniff, clickjacking protection, referrer policy, `noindex` robots tag, and HSTS on HTTPS).

### Modified Capabilities
- `configuration`: adds internal, non-secret auth settings (`authMode`, `authUsername`,
  `authPasswordHash`, `authSessionVersion`) stored in the existing `settings` KV **outside**
  `AppConfig`/`ENV_MAP`/`WRITABLE_KEYS` (same pattern as `cachedLibraries`/`kometa*`); an
  `AUTH_MODE` env override that wins over the persisted value and locks the UI control; a fail-open
  guard when auth is on but credentials are missing; and a boot-time permission guard for the
  encryption key file.
- `poster-application`: the custom-upload apply path validates image content (magic-byte allow-list)
  and enforces a size cap before applying, rejecting invalid files with a clear error.
- `poster-providers`: outbound provider/scraper fetches respect an upstream `Retry-After` header on
  429/503 responses before the next retry attempt.
- `deployment`: the container image runs from a pinned base and defines a `HEALTHCHECK`; CI builds
  the image; docs cover the auth/proxy env vars (`AUTH_MODE`, `ADDRESS_HEADER`, `XFF_DEPTH`). The
  container user is unchanged (still root) — no ops migration.

## Impact

- **Schema:** none. Auth state rides the existing `settings` KV table (4 new keys).
- **Server:** `hooks.server.ts` becomes `sequence(handleAuth, handleParaglide)`; new `$env`-free
  modules under `src/lib/server/auth/` (password, session, local-address, guard, login-throttle) and
  `src/lib/server/http/` (retry-after) and image-type sniffing; new auth API routes
  (`/api/auth/credentials`, `/api/auth/logout`) and a `/login` page + Security settings section;
  `config/index.ts` gains the auth KV accessors and the boot permission guard; `http/index.ts`
  gains `Retry-After` handling; the upload route gains validation; query call-sites parallelized.
- **Session/hashing keys:** derived from the existing instance key via `getEncryptionKey()`
  (`secrets/key.ts`), HKDF-style domain separation — no new secret to manage. Password hash is
  **not** AES-encrypted (a hash is not recoverable material; encrypting it would couple login to
  `.app-key`).
- **Ops (non-breaking):** the container user is unchanged (still root) and no volume ownership
  changes, so existing installs upgrade with no migration step.
- **CI/Docker:** `ci.yml` adds a `docker build` step; `Dockerfile` pins the base and adds a tool-free
  `HEALTHCHECK` against the existing `/api/health`.
- **i18n:** new keys across all 5 catalogs (`en`, `es`, `zh`, `ja`, `pt-BR`) for login and Security.
- **No breaking UI changes:** with `AUTH_MODE` unset the default is `disabled` — every existing
  install behaves exactly as before until a user opts in.

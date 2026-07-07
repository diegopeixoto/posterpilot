## Context

A three-front diagnosis of the project found it healthy overall — clean code (no TODOs/FIXMEs),
secrets encrypted at rest (AES-GCM), perfect i18n parity (5 catalogs), CI with typecheck/test/format,
above-average accessibility. The single biggest exposure is that **there is no authentication**:
anyone who reaches the port can change settings, apply artwork, and upload files, and the app stores
media-server tokens.

The maintainer's decision is to solve this the **\*arr way** (Sonarr/Radarr): optional auth with a
local-network bypass, in one focused PR, together with a delimited set of hardening/perf work. The
rest of the diagnosis (library pagination, wall thumbnails, toasts/skeletons/keyboard, page
decomposition, Plex dedup, ESLint, `kometa/sync` tests, docs screenshots) stays as follow-ups.

Relevant existing machinery this design reuses:
- `settings` KV table with internal, non-`AppConfig` keys (`cachedLibraries`, `kometa*`) via
  `readKv`/`writeKv` (`src/lib/server/config/index.ts:412-509`).
- Instance encryption key resolved by `getEncryptionKey()` (`src/lib/server/secrets/key.ts`), with
  the pure-over-the-key crypto pattern (`enc:v1:` self-describing strings) in `secrets/crypto.ts`.
- Single inline Paraglide middleware in `src/hooks.server.ts` (becomes a `sequence`).
- Shared fetch with p-retry backoff in `src/lib/server/http/index.ts` (`fetchFresh`).
- Custom-poster upload at `src/routes/api/items/[id]/upload/+server.ts` (currently no validation).
- Existing public health probe at `/api/health`; SSE progress at `/api/jobs/[id]/stream`.

## Goals / Non-Goals

**Goals:**
- Optional auth (`disabled` default) that is invisible to existing installs until opted in.
- A local-network bypass (`local` mode) that is **fail-closed** behind reverse proxies.
- No possible lockout: an env override always recovers an instance, and misconfiguration fails open
  to the pre-feature state rather than bricking access.
- Zero schema migration; no new secret to manage; all new pure logic is `$env`-free and unit-tested.
- A delimited hardening/perf set that is cheap to land in the same PR.
- The auth UI (login page, Security settings, logout, lockout messaging) held to PRODUCT.md's design
  principles (cinematic, dark, one violet accent, AA + reduced-motion).

**Non-Goals:**
- Multi-user, roles, OAuth/OIDC/SSO, API keys/tokens for programmatic access — out of scope.
- Server-side session storage or a session table — sessions are stateless.
- Anything on the deferred follow-up list above.
- Encrypting the password hash (a hash is not recoverable material).
- **Non-root container — out of scope entirely.** Changing the container user is the only breaking
  ops change and needs its own migration story; it is not worth coupling to this PR. The container
  keeps running as root (status quo). The non-breaking Docker wins (pinned base, HEALTHCHECK, CI
  `docker build`) stay in.

## Decisions

### Storage — no schema migration
Four KV rows in the existing `settings` table, **outside** `AppConfig`/`ENV_MAP`/`WRITABLE_KEYS`
(the same pattern as `cachedLibraries` and `kometa*`):

| KV key | Value |
|---|---|
| `authMode` | `disabled` \| `enabled` \| `local` (default `disabled`) |
| `authUsername` | text (not a secret) |
| `authPasswordHash` | `scrypt:v1:N,r,p:<salt b64>:<hash b64>` |
| `authSessionVersion` | integer; bumping it invalidates every session |

Rationale: `ENV_MAP` is exhaustive over `AppConfig`, so putting auth there would force spurious env
vars and leak into `publicConfig()`/`saveSettings()`. The hash is **not** AES-encrypted: a hash is
not recoverable, and encrypting it would couple login to `.app-key` and lock the user out if the file
were lost. **Anti-lockout escape hatch:** env `AUTH_MODE` wins over the persisted value
(`AUTH_MODE=disabled` recovers a locked install) and locks the UI control. **Fail-open guard:** if
`authMode != disabled` but username/hash is missing, the effective mode drops to `disabled` (the
pre-feature state — avoids bricking via a manual DB edit).

Alternative considered: a dedicated `auth` table + Drizzle migration — rejected as unnecessary
surface for four scalar values that fit the established KV convention.

### Password hashing — pure, `$env`-free module
`scrypt` **async** (never `scryptSync`, so login never blocks the event loop), 16-byte random salt,
N=16384/r=8/p=1, 32-byte output. Self-describing `scrypt:v1:...` string with params embedded (mirrors
`enc:v1:` in `secrets/crypto.ts`). `verifyPassword` uses `timingSafeEqual` and never throws.

Alternative considered: bcrypt/argon2 — rejected to avoid a native dependency; Node's built-in scrypt
is sufficient for a single-operator app and keeps the module dependency-free and unit-testable.

### Session — stateless, signed cookie
- Key: `deriveSessionKey(masterKey) = HMAC-SHA256(masterKey, 'posterpilot:session:v1')` — a separate
  domain from the AES key; `masterKey` comes from `getEncryptionKey()`.
- Token: `v1.<b64url(payload)>.<b64url(HMAC sig)>`, payload `{ u, v, iat, exp }`.
- Sliding expiry: 14-day TTL; the token is re-issued when `now − iat > 24h` (an active user never
  expires; an idle one expires in 14 days).
- Cookie `pp_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, **`Secure` conditional on https** (HTTP
  LAN installs are common; unconditional `Secure` would make the cookie never stick).
- Invalidation: bumping `authSessionVersion` kills all sessions (credential change); logout clears
  the cookie.

Alternative considered: server-side sessions in SQLite — rejected; stateless keeps the "no
migration, no table" constraint and there is only one user.

### Local-address detection + proxy trust — fail-closed
- `isLocalAddress`: loopback, RFC1918, link-local, IPv6 ULA, IPv4-mapped IPv6; garbage → false.
- `decideLocalBypass`: if **no** `ADDRESS_HEADER` is configured but the request carries
  `X-Forwarded-For`/`Forwarded`, treat it as **non-local**. Behind a proxy the socket is the proxy's
  IP (usually RFC1918); without this guard all internet traffic would look "local". A direct LAN
  client never sends that header, so its presence without configured trust is the proxy signature.
- **Local addresses always win.** In `local` mode a local-address request bypasses unconditionally —
  the session cookie is only consulted for non-local requests. There is therefore no "logout" for LAN
  access in `local` mode (the LAN user is never logged in in the first place).
- Docs recommend `ADDRESS_HEADER=x-forwarded-for` + `XFF_DEPTH` (adapter-node built-ins).

### Route guard — `hooks.server.ts` + pure `guard.ts`
`export const handle = sequence(handleAuth, handleParaglide)`. The current inline Paraglide handle
becomes `handleParaglide`; `handleAuth` runs first. `classifyPath` + `safeRedirectTarget`
(open-redirect guard: must start with `/`, not `//`, no `\`).

| Route | Unauthenticated |
|---|---|
| `/api/health` | public (container probe) |
| `/login`, `/api/auth/logout` | public |
| `/_app/*` + a static-asset allow-list | public |
| other `/api/*` (incl. SSE `/api/jobs/[id]/stream`) | `401` JSON |
| other pages | `303` → `/login?redirectTo=<path+search>` |

CSRF: login is a form action (covered by Kit's default `checkOrigin`); the `SameSite=Lax` cookie
protects the JSON APIs. In-memory per-IP login throttle (5 failures / 15 min + ~300 ms delay on
failure).

### First-enable flow — `POST /api/auth/credentials` (first real use of zod)
Body `{ mode, username?, password? }` validated with zod. Enabling requires credentials (existing or
in the request). **After saving, the same response issues a fresh session cookie to the author** — the
person who just enabled auth cannot be logged out by their own save (the old cookie is
version-invalidated). Disabling preserves credentials. The password is never logged.

### SSE open at logout — accepted
Stateless tokens are only checked at connection time; an open `/api/jobs/[id]/stream` survives logout
until it closes naturally. Its content is job progress (not sensitive). Accepted and documented in a
code comment.

### [Extra] Security response headers
Set on every response in the same handle chain (a small `handleSecurityHeaders`, or folded into
`handleAuth`): `X-Content-Type-Options: nosniff`, clickjacking protection
(`X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`), `Referrer-Policy: same-origin`,
`X-Robots-Tag: noindex` (a private self-hosted app should not be indexed if exposed), and
`Strict-Transport-Security` **only when the request is https** (matching the conditional-`Secure`
reasoning — never send HSTS to an HTTP LAN client). No full CSP `default-src` in this PR (the app's
inline/style surface isn't audited yet — that would risk breaking the UI); `frame-ancestors` is the
one safe CSP directive to add now.

### [Extra] Secret-key-file permission guard
At boot (in the existing startup path in `hooks.server.ts`, after `migrateDb()`), if the resolved
`.app-key` exists but its mode is group- or world-readable (looser than owner-only `0600`), log a
prominent warning. Cheap hygiene: the key that protects every stored secret should not be readable by
other users on the host. Warning only — never fatal.

### [Extra] Auth event logging
Structured single-line logs (reusing the app's existing logger) on: login success, login failure,
lockout trip, credential change, and effective-mode fail-open. Never log the password or the session
token. Gives operators a way to diagnose lockouts and throttle hits.

### [Hardening] Validated uploads
The upload route sniffs **magic bytes** to an allow-list (jpeg `FF D8 FF`, png `89 50 4E 47`, webp
`RIFF....WEBP`) via a pure `image-type.ts` module, and rejects files over a **15 MB** size cap with
`413`, and wrong-type files with `415` — before `applyCustomUpload`. Body shape validated with zod.
The declared `file.type` is not trusted (a `.txt` renamed `.jpg` is rejected by content).

### [Hardening] `Retry-After`
`fetchFresh` in `http/index.ts` captures a `Retry-After` header on 429/503 and, via p-retry's
`onFailedAttempt`, waits at least that long (capped) before the next attempt, instead of only
exponential backoff. A pure `retry-after.ts` parses both the delta-seconds and HTTP-date forms.
p-retry v8's `onFailedAttempt` signature is `(context) => void | Promise<void>` with `context.error`.

### [Hardening] Docker & CI (non-breaking wins)
The image pins its base (digest/tag), adds a tool-free `HEALTHCHECK` probing the existing
`/api/health` (a small `bun` one-liner, no curl/wget needed), and CI runs `docker build` on PRs. The
container **keeps running as root** (status quo) — no user or ownership change, so none of this
carries an ops migration. Non-root is intentionally out of scope (see Non-Goals): it is the only
breaking ops change and belongs in its own PR with a proper migration story.

### [Perf] Query parallelization
Independent per-request DB queries currently awaited serially (e.g. in page `load`s and dashboard
counts) are run with `Promise.all`. Pure internal change, no behavior difference. Where counts use
`count(*) FILTER (...)` (SQLite ≥3.30, libsql OK), a `sum(case when …)` fallback is available.

## Risks / Trade-offs

- **Container still runs as root** → Non-root is out of scope (its own PR). A compromised app
  process has root inside the container. Accepted for now (single-user self-hosted threat model); the
  permission guard (Extra #2) still flags a group/world-readable `.app-key`.
- **`Secure`/HSTS gated on protocol** → An HTTP-only LAN install gets neither; that is intentional
  (unconditional `Secure` breaks the cookie). Mitigation: documented; https installs get both.
- **Fail-closed proxy detection can surprise** → A direct-LAN client that somehow sends
  `X-Forwarded-For` is treated as non-local. Mitigation: documented; correct default is safer than
  fail-open, and configuring `ADDRESS_HEADER` makes intent explicit.
- **SSE survives logout** → Accepted; content is non-sensitive job progress.
- **`count(*) FILTER` needs SQLite ≥3.30** → libsql satisfies it; `sum(case when …)` fallback ready.

## Migration Plan

**This PR is fully non-breaking.** With `authMode` default `disabled` and no change to the container
user, every existing install upgrades untouched — no `chown`, no ops migration.

1. Ship with `authMode` default `disabled` → every existing install behaves exactly as before.
2. Document new env: `AUTH_MODE` (override + lockout recovery), `ADDRESS_HEADER`/`XFF_DEPTH` (proxy
   trust for `local` mode).
3. Rollback: revert the image; auth state in KV is inert when `authMode=disabled`, so downgrading is
   safe. Setting `AUTH_MODE=disabled` (or clearing the KV rows) fully disables the feature.

## Resolved Decisions

- **Upload size cap: 15 MB** (`413` over it).
- **`local` mode: local addresses always bypass** unconditionally; the session cookie is only for
  non-local access, and there is no logout for LAN access in `local` mode.
- **Login throttle: 5 failures / 15 min** + ~300 ms delay on failure.
- **Non-root container: dropped entirely** — the container keeps running as root; the non-breaking
  Docker wins (pinned base, HEALTHCHECK, CI `docker build`) stay in.

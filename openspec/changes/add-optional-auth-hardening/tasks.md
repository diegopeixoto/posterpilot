## 1. Auth pure modules (`$env`-free, unit-tested)

- [x] 1.1 `src/lib/server/auth/password.ts` — async scrypt hash/verify, self-describing `scrypt:v1:N,r,p:salt:hash`, `timingSafeEqual`, never throws + `password.test.ts`
- [x] 1.2 `src/lib/server/auth/session.ts` — `deriveSessionKey(masterKey)` (HMAC domain-separated), sign/verify token `v1.<payload>.<sig>`, sliding-expiry re-issue logic + `session.test.ts`
- [x] 1.3 `src/lib/server/auth/local-address.ts` — `isLocalAddress` (loopback/RFC1918/link-local/ULA/IPv4-mapped) + `decideLocalBypass` fail-closed on forwarded-for + `local-address.test.ts`
- [x] 1.4 `src/lib/server/auth/guard.ts` — `classifyPath` (public allow-list vs API vs page) + `safeRedirectTarget` open-redirect guard + `guard.test.ts`
- [x] 1.5 `src/lib/server/auth/login-throttle.ts` — in-memory per-IP failure counter (5/15min + delay), pure over an injected clock + `login-throttle.test.ts`

## 2. Config & secrets integration

- [ ] 2.1 Add auth KV accessors (`getAuthMode`/`setAuthMode`, username, password hash, session version) to `config/index.ts` via existing `readKv`/`writeKv`, outside `AppConfig`/`ENV_MAP`/`WRITABLE_KEYS`
- [ ] 2.2 `AUTH_MODE` env override precedence + `effectiveAuthMode()` with fail-open guard (mode on but no creds → `disabled`); ensure auth keys excluded from `publicConfig()`
- [ ] 2.3 [Extra] Boot-time `.app-key` permission guard in `hooks.server.ts` startup path — warn (never fatal) if group- or world-readable

## 3. Request hook wiring

- [x] 3.1 Refactor `hooks.server.ts` to `export const handle = sequence(handleAuth, handleParaglide)` (existing inline paraglide → `handleParaglide`)
- [x] 3.2 `handleAuth` — resolve effective mode, local bypass, verify session cookie, enforce guard (401 JSON for APIs, 303 redirect for pages), sliding re-issue; set `event.locals.authed`
- [x] 3.3 [Extra] Security response headers (nosniff, `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, `Referrer-Policy`, `X-Robots-Tag: noindex`, HSTS on https only) applied to every response
- [x] 3.4 [Extra] Auth event logging (success/failure/lockout/credential-change) via `logEvent`, never logging password or token — in the login action, credentials route, and logout route

## 4. Auth API routes & UI

- [x] 4.1 `POST /api/auth/credentials` — zod-validated `{ mode, username?, password? }`; enable requires creds; bump session version; **issue fresh cookie to author in same response**; never log password; 409 when env-locked
- [x] 4.2 `POST /api/auth/logout` — clear `pp_session`, public route
- [x] 4.3 `/login` page + form action (username+password), safe `redirectTo` handling, lockout + error feedback; styled per PRODUCT.md (dark, violet accent, AA, reduced-motion)
- [x] 4.4 Settings → Security section — mode selector (`disabled`/`enabled`/`local`), set/change credentials, env-locked state display; logout control in the header layout
- [x] 4.5 i18n: add login + Security keys to all 5 catalogs (`en`/`es`/`zh`/`ja`/`pt-BR`) at parity (+24 each, 429 total)

## 5. Hardening — upload validation

- [x] 5.1 `src/lib/server/posters/image-type.ts` — pure magic-byte sniff (jpeg/png/webp) + `image-type.test.ts`
- [x] 5.2 Wire 15 MB size cap (413) + magic-byte check (415) into `api/items/[id]/upload/+server.ts` before `applyCustomUpload`; cap overridable via `MAX_UPLOAD_MB` (default 15)
- [x] 5.3 Reject client-declared `file.type`; drive apply off sniffed type

## 6. Hardening — Retry-After

- [x] 6.1 `src/lib/server/http/retry-after.ts` — pure parser for delta-seconds and HTTP-date forms, bounded cap + `retry-after.test.ts`
- [x] 6.2 Capture `Retry-After` on 429/503 in `fetchFresh` and honor it via p-retry `onFailedAttempt` (`context.error`), falling back to backoff when absent/invalid

## 7. Perf — query parallelization

- [x] 7.1 Parallelized independent serial `await`s with `Promise.all` in the dashboard, settings, and item-detail loads (library load already parallel); behavior identical
- [x] 7.2 No `count(*) FILTER` in the codebase (plain `count(*)` only) — no fallback needed

## 8. Docker & CI hardening (non-breaking; container stays root)

- [x] 8.1 `Dockerfile` — pinned base to `oven/bun:1.2`, added tool-free `HEALTHCHECK` probing `/api/health` (bun one-liner); no container-user change
- [x] 8.2 `docker-compose.yml` — documented auth/proxy env (`AUTH_MODE`, `ADDRESS_HEADER`, `XFF_DEPTH`, `MAX_UPLOAD_MB`)
- [x] 8.3 `.github/workflows/ci.yml` — added a `docker build` job (buildx, no push) on PR

## 9. Docs

- [x] 9.1 Deployment docs — `AUTH_MODE`, `ADDRESS_HEADER`/`XFF_DEPTH`, `local`-mode fail-closed proxy note (new Authentication section in configuration.md)
- [x] 9.2 Stated the upgrade is **non-breaking** (auth defaults `disabled`, container user unchanged) in the docs note
- [x] 9.3 Documented auth modes, session behavior, anti-lockout + env-var reference rows

## 10. Verification

- [x] 10.1 Gates: `bun run check` (0 errors), `bun run test` (345 pass), `bun run build` (ok), `bun run lint` (clean)
- [x] 10.2 Smoke-tested the built server (throwaway DB): auth-off passthrough + all 5 security headers; `/login`→303 when off; enable keeps author logged in; no-cookie API→401 / health→200; deep-link `redirectTo` preserved; login success sets cookie→authed, wrong pw sets none, logout→401 again; CSRF forbids cross-origin form POST; `AUTH_MODE=disabled` env override recovers lockout + credential change→409; `local` localhost bypass vs forged `X-Forwarded-For`→401 fail-closed; auth events logged with no password. Unit-verified (not HTTP): upload 413/415 (sniff has 7 tests; route 404s first on empty DB), session-version invalidation, open-redirect. **Left for the PR manual pass:** SSE live progress, `docker build` + healthcheck, upload 413/415 against a real item.

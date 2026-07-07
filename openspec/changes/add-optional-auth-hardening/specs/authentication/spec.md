## ADDED Requirements

### Requirement: Optional authentication modes

The system SHALL support three authentication modes — `disabled`, `enabled`, and `local` — with
`disabled` as the default. In `disabled` mode no login is required. In `enabled` mode every non-public
route requires an authenticated session. In `local` mode requests from local network addresses bypass
authentication while all other requests require an authenticated session.

#### Scenario: Default is disabled

- **WHEN** the application starts on an install that has never configured authentication
- **THEN** the effective mode is `disabled` and every route works without a login, exactly as before

#### Scenario: Enabled requires a session

- **WHEN** the mode is `enabled` and an unauthenticated request reaches a non-public route
- **THEN** the system denies access (redirect for pages, `401` for APIs) until the user logs in

#### Scenario: Local bypass for local addresses

- **WHEN** the mode is `local` and a request originates from a local network address
- **THEN** the system serves the request without requiring a session

### Requirement: Password credentials

The system SHALL store a single username (non-secret) and a password verifier that is a salted hash,
never plaintext and never reversible. Password hashing SHALL be non-blocking and verification SHALL be
constant-time.

#### Scenario: Password stored as a non-reversible hash

- **WHEN** the user sets or changes the password
- **THEN** the persisted value is a salted hash (with embedded parameters), and the plaintext password
  is neither stored nor logged

#### Scenario: Correct password authenticates

- **WHEN** a login submits the configured username and correct password
- **THEN** the system establishes an authenticated session

#### Scenario: Wrong password rejected

- **WHEN** a login submits a wrong password
- **THEN** the system rejects it without revealing whether the username or the password was wrong

### Requirement: Signed stateless session

The system SHALL represent an authenticated session as a signed cookie with no server-side session
storage. The session SHALL carry a sliding expiry so an active user is not logged out mid-use while an
idle session expires. The session cookie SHALL be `HttpOnly` and `SameSite=Lax`, and SHALL be marked
`Secure` only when the request is served over HTTPS.

#### Scenario: Tampered token rejected

- **WHEN** a request presents a session cookie whose signature does not verify
- **THEN** the system treats the request as unauthenticated

#### Scenario: Active session slides forward

- **WHEN** an authenticated user keeps using the app past the sliding-refresh threshold
- **THEN** the system re-issues the session so the user is not logged out, up to the maximum idle TTL

#### Scenario: Secure flag follows protocol

- **WHEN** the app is accessed over plain HTTP on a LAN
- **THEN** the session cookie is set without the `Secure` flag so it is retained, and over HTTPS the
  cookie is set with `Secure`

### Requirement: Route guard and public allow-list

The system SHALL enforce access in a request hook that runs before application handling. It SHALL keep
a public allow-list — the health probe, the login page, the logout endpoint, and static app assets —
reachable without a session. Unauthenticated access to other API routes SHALL return `401` JSON;
unauthenticated access to other pages SHALL redirect to the login page with a safe `redirectTo` back
to the requested path.

#### Scenario: Health probe stays public

- **WHEN** the container health probe requests the health endpoint without a session
- **THEN** the system returns a success response regardless of auth mode

#### Scenario: Protected API returns 401

- **WHEN** an unauthenticated request hits a protected API route
- **THEN** the system returns `401` with a JSON body rather than an HTML redirect

#### Scenario: Deep link preserved through login

- **WHEN** an unauthenticated user requests a protected page with a path and query
- **THEN** the system redirects to the login page carrying a `redirectTo` that returns them to that
  exact path after login

#### Scenario: Open-redirect blocked

- **WHEN** a `redirectTo` value is not a same-site absolute path (e.g. starts with `//`, contains a
  backslash, or is an external URL)
- **THEN** the system ignores it and redirects to the site root

### Requirement: Fail-closed proxy trust for local bypass

The system SHALL detect local network addresses (loopback, RFC1918, link-local, IPv6 ULA, and
IPv4-mapped IPv6). When no trusted address header is configured but a request carries a forwarded-for
header, the system SHALL treat the request as non-local, so a reverse proxy cannot make all traffic
appear local.

#### Scenario: Proxied internet traffic is not local

- **WHEN** the mode is `local`, no address header is configured, and a request arrives with an
  `X-Forwarded-For`/`Forwarded` header
- **THEN** the system treats the request as non-local and requires a session

#### Scenario: Direct LAN client bypasses

- **WHEN** the mode is `local` and a direct LAN client (no forwarded-for header) connects from an
  RFC1918 address
- **THEN** the system serves the request without a session

### Requirement: Anti-lockout override and fail-open guard

The system SHALL let an `AUTH_MODE` environment variable override the persisted mode and lock the
in-app control, so an operator can always recover a locked instance. If the effective mode is not
`disabled` but a username or password hash is missing, the system SHALL fall back to `disabled` rather
than deny all access.

#### Scenario: Env override recovers a locked instance

- **WHEN** the operator sets `AUTH_MODE=disabled`
- **THEN** the persisted mode is ignored, login is bypassed, and the Security control shows it is
  locked by the environment

#### Scenario: Missing credentials fail open

- **WHEN** the persisted mode is `enabled` or `local` but no username/password hash is set
- **THEN** the effective mode is `disabled` and the app remains reachable

### Requirement: Login throttle

The system SHALL throttle repeated failed logins per client to slow brute-force attempts, delaying or
temporarily blocking further attempts after a threshold, without persisting per-attempt state.

#### Scenario: Repeated failures are throttled

- **WHEN** a client exceeds the failed-login threshold within the window
- **THEN** the system rejects further attempts for the lockout period regardless of whether the next
  password is correct

### Requirement: First-enable keeps the author logged in

The system SHALL provide an endpoint to set the mode and credentials with a validated request body.
Enabling authentication SHALL require credentials (already stored or supplied in the request). On a
successful save that enables or changes credentials, the system SHALL issue a fresh session to the
requester in the same response, so the user who just enabled auth is not logged out by their own
change. Disabling SHALL preserve stored credentials.

#### Scenario: Enabling does not lock out the author

- **WHEN** a user enables authentication and sets a username and password
- **THEN** the response leaves that user authenticated with a valid session and a logout control
  available

#### Scenario: Enabling without credentials is rejected

- **WHEN** a user tries to enable authentication while no credentials are stored or supplied
- **THEN** the system rejects the request with a validation error and does not change the mode

#### Scenario: Disabling preserves credentials

- **WHEN** a user switches the mode back to `disabled`
- **THEN** the stored username and password hash are retained for a later re-enable

### Requirement: Logout and session invalidation

The system SHALL provide a logout that clears the session cookie, and SHALL invalidate all existing
sessions when credentials change (via a session version that is bumped on credential change).

#### Scenario: Logout clears the session

- **WHEN** an authenticated user logs out
- **THEN** the session cookie is cleared and the next protected request is unauthenticated

#### Scenario: Credential change invalidates other sessions

- **WHEN** the password is changed
- **THEN** sessions issued before the change no longer authenticate on their next request

### Requirement: Login and Security UI

The system SHALL provide a login page and a Security section in Settings for choosing the mode and
setting credentials, and SHALL surface a logout control when authenticated. These surfaces SHALL
follow the product's design principles (dark, single violet accent, WCAG AA, `prefers-reduced-motion`
honored) and SHALL provide clear feedback for lockout and for env-locked mode.

#### Scenario: Login page reachable when enabled

- **WHEN** authentication is enabled and an unauthenticated user is redirected to log in
- **THEN** a login form (username + password) is presented, styled per the product design principles

#### Scenario: Env-locked control is visible

- **WHEN** `AUTH_MODE` is set in the environment
- **THEN** the Security section shows the mode as locked by the environment and does not let the user
  change it in the UI

#### Scenario: Lockout feedback

- **WHEN** a user is throttled after repeated failed logins
- **THEN** the login page communicates that further attempts are temporarily blocked, without relying
  on color alone

### Requirement: Auth event logging

The system SHALL emit structured log entries for login success, login failure, lockout, and
credential change, and SHALL never include the password or the session token in any log output.

#### Scenario: Failed login is logged without the password

- **WHEN** a login attempt fails
- **THEN** the system logs the failure (with client and reason) and the password does not appear in
  the log

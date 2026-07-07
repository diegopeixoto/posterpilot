## ADDED Requirements

### Requirement: Baseline security response headers

The system SHALL set baseline hardening headers on every HTTP response: `X-Content-Type-Options:
nosniff`, a clickjacking protection (`X-Frame-Options: DENY` and a CSP `frame-ancestors 'none'`
directive), a `Referrer-Policy`, and `X-Robots-Tag: noindex` (the application is private and SHALL
NOT be indexed by crawlers). The system SHALL send `Strict-Transport-Security` only when the request
is served over HTTPS, mirroring the conditional handling of the `Secure` cookie flag.

#### Scenario: Headers present on responses

- **WHEN** any page or API response is returned
- **THEN** it carries `X-Content-Type-Options: nosniff`, a clickjacking protection header, a
  `Referrer-Policy`, and `X-Robots-Tag: noindex`

#### Scenario: HSTS only over HTTPS

- **WHEN** a response is served over plain HTTP on a LAN
- **THEN** no `Strict-Transport-Security` header is sent, and over HTTPS the header is present

#### Scenario: Framing blocked

- **WHEN** another site attempts to embed the app in an iframe
- **THEN** the clickjacking headers instruct the browser to refuse the frame

# poster-application — delta

## ADDED Requirements

### Requirement: Trusted artwork hosts cover provider CDNs
The apply pipeline SHALL accept candidate artwork URLs from every host a built-in
provider actually serves candidates on — for ThePosterDB both `theposterdb.com` /
`www.theposterdb.com` (legacy `/api/assets` form) and `images.theposterdb.com`
(CDN form) — and SHALL reject URLs from hosts outside the per-provider allowlist.

#### Scenario: CDN-hosted ThePosterDB candidate applies
- **WHEN** a staged ThePosterDB candidate whose URL is on `images.theposterdb.com` is applied
- **THEN** the apply proceeds through the trust check and the artwork is written

#### Scenario: Untrusted host is rejected
- **WHEN** a candidate URL points at a host not on the provider's allowlist
- **THEN** the apply refuses that candidate

### Requirement: Warning-free single-item applies auto-confirm
When the user applies a staged selection for a single item and the produced plan
preview contains no warnings and no skipped targets, the system SHALL confirm the
plan immediately without showing the confirmation dialog. When the preview carries
any warning or skip, or the flow is apply-and-next, the confirmation dialog SHALL
be shown as before. The two-phase plan/digest server protocol is unchanged.

#### Scenario: Clean plan applies in one click
- **WHEN** the user hits apply on an item and the plan preview has no warnings or skips
- **THEN** the apply is confirmed automatically and feedback appears without an intermediate dialog

#### Scenario: Plan with warnings still asks
- **WHEN** the plan preview reports a warning or a skipped target
- **THEN** the confirmation dialog is shown before anything is written

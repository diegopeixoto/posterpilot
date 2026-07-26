# web-ui — delta

## ADDED Requirements

### Requirement: Per-provider re-search controls
The item page SHALL offer a per-provider re-search control that forces a fresh
discovery for exactly that provider (`POST /api/items/[id]/discover` with a provider
scope filtered against known provider ids). The collection page SHALL offer a
discovery control that re-runs discovery across the collection's members and reports
progress (running / done / failed counts). Unknown provider ids SHALL be ignored,
never breaking the whole discovery call.

#### Scenario: Re-search one provider
- **WHEN** the user activates the re-search control on a provider's header
- **THEN** only that provider's results refresh, bypassing the HTTP cache

#### Scenario: Collection-wide discovery
- **WHEN** the user runs discovery from the collection page
- **THEN** each member is refreshed best-effort and the UI reports how many succeeded and failed

### Requirement: Disabled providers' candidates are hidden
Stored candidates from a provider that is currently disabled or unavailable
(missing credential) SHALL NOT be shown on the item page. Re-enabling the provider
SHALL surface the stored candidates again without re-running discovery.

#### Scenario: Disable hides, re-enable restores
- **WHEN** the user disables a provider in settings and reopens an item
- **THEN** that provider's stored candidates are absent; re-enabling shows them again

### Requirement: Reserved per-provider candidate slots
When member candidates are capped, selection SHALL reserve a small number of slots
per provider inside the cap (filled by score, final list restored to score order) so
one high-scoring provider cannot crowd out all others.

#### Scenario: Mixed providers survive the cap
- **WHEN** one provider's candidates outscore another's across the board
- **THEN** the capped list still contains the reserved minimum from the other provider

### Requirement: ThePosterDB group expanded by default
The ThePosterDB candidate group on the item page SHALL render expanded by default,
as a flat list rather than per-creator cards.

#### Scenario: Flat expanded list
- **WHEN** an item has ThePosterDB candidates
- **THEN** they are visible without an extra expand click, in one flat list

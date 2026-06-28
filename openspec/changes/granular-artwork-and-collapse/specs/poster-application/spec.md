## ADDED Requirements

### Requirement: Select season and episode artwork

The system SHALL let a user stage artwork for an individual season (a season poster) and
for an individual episode (a title card), independently of the show-level poster/background
and independently of each other. Each season/episode slot SHALL be persisted as its own
pending selection and SHALL be clearable by re-selecting the staged candidate. The selection
model SHALL also represent a season background slot so a source can be added later, even
though no provider currently discovers one.

#### Scenario: Stage a season slot

- **WHEN** the user picks a season poster or season background candidate for a given season
- **THEN** the system records that candidate as the pending selection for that season's
  poster or background slot, leaving the show-level and other seasons' selections unchanged

#### Scenario: Stage an episode title card

- **WHEN** the user picks a title-card candidate for a given episode
- **THEN** the system records it as the pending selection for that episode's title-card slot

#### Scenario: Clear a staged slot

- **WHEN** the user re-selects the candidate already staged in a season or episode slot
- **THEN** the system clears that slot's pending selection without affecting any other slot

### Requirement: Stage a full set across seasons and episodes

When a user chooses "use this set", the system SHALL stage every slot the set covers —
the show poster/background plus each season's poster/background and each episode's title
card — matched to the corresponding season/episode number. The user SHALL be able to
override any individual slot afterward without losing the rest of the staged set.

#### Scenario: Use set fills all covered slots

- **WHEN** the user chooses "use this set" on a set that includes season and episode artwork
- **THEN** the system stages the show, season, and episode slots from that set, matching each
  candidate to its season/episode number

#### Scenario: Per-slot override after using a set

- **WHEN** the user has staged a full set and then picks a different candidate for one
  season or episode slot
- **THEN** the system replaces only that slot's selection and keeps every other staged slot

### Requirement: Apply staged season and episode artwork

A single apply action SHALL write every staged slot — show, seasons, and episodes — using
the chosen method(s). For direct apply the system SHALL resolve each season/episode child
on the active media server by number and upload to it; a staged slot with no matching child
on the server SHALL be skipped and reported rather than failing the whole apply, and a
single child's failure SHALL NOT abort the remaining slots.

#### Scenario: Apply writes children directly

- **WHEN** the user applies with the direct method and has season/episode slots staged
- **THEN** the system resolves each staged season/episode child by number and uploads and
  locks its artwork, alongside the show-level poster/background

#### Scenario: Staged slot has no matching child

- **WHEN** a staged season or episode number has no corresponding child on the media server
- **THEN** the system skips that slot, applies the rest, and reports the skipped slot

#### Scenario: One child fails

- **WHEN** uploading one staged child's artwork fails
- **THEN** the system still applies the remaining staged slots and reports the per-child
  failure independently

### Requirement: Export season and episode artwork to Kometa

Kometa YAML export SHALL include per-season and per-episode artwork for a show: each staged
season poster as a `seasons:` entry keyed by season number and each staged episode title
card as an `episodes:` entry keyed by episode number under its season, in addition to the
show-level `url_poster`/`url_background`. Season **background** SHALL NOT be written to the
YAML (it is applied via the direct method only).

#### Scenario: Season poster and episode title card exported

- **WHEN** a Kometa export runs for a show with staged season posters and episode title cards
- **THEN** the YAML contains `seasons:` entries with `url_poster` keyed by season number and
  `episodes:` entries with the title-card URL keyed by episode number under their season

#### Scenario: Season background omitted from YAML

- **WHEN** a show has a staged season background and the export method includes Kometa
- **THEN** the system omits the season background from the YAML while still applying it via
  the direct method when that method is also selected

### Requirement: Record applied child artwork

The system SHALL record each applied season/episode slot in apply history with its kind and
its season and (for episodes) episode number, so granular history is queryable and
re-application and revert are scopeable. Show-level applications SHALL continue to be
recorded with no season/episode.

#### Scenario: Child application recorded

- **WHEN** a season or episode slot is applied (success or failure)
- **THEN** the history record includes the kind, season number, and episode number (for
  episodes) alongside the item, URL, method, status, and timestamp

### Requirement: Revert applied artwork at full and per-season scope

The system SHALL support reverting all applied artwork for an item (show-level plus every
applied season and episode) and reverting a single season (that season's poster/background
plus its episodes' title cards). Reversal SHALL reuse the show-level revert mechanism and
SHALL re-resolve season/episode children by number.

#### Scenario: Revert all

- **WHEN** the user reverts an item with the full scope
- **THEN** the system reverts the show-level artwork and every applied season and episode

#### Scenario: Revert a single season

- **WHEN** the user reverts a specific season
- **THEN** the system reverts only that season's poster/background and its episodes' title
  cards, leaving the show-level and other seasons' artwork in place

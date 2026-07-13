# poster-application Specification

## Purpose

Define artwork selection, staging, direct-server and Kometa application, audit history, and restoration behavior for title and child slots.
## Requirements
### Requirement: Select a candidate cover

The system SHALL let a user stage a pending selection for an item consisting of a poster and/or a background chosen from the discovered MediaUX candidates. The user SHALL be able to stage both pieces of one set at once ("use this set") or take an individual poster or background from any set. The system SHALL support an automatic selection that picks the newest set's primary poster.

#### Scenario: Manual selection

- **WHEN** the user picks a specific poster or background candidate for an item
- **THEN** the system records that candidate as the corresponding pending selection (poster or background) for the item

#### Scenario: Stage a whole set

- **WHEN** the user chooses "use this set" on a set that has both a poster and a backdrop
- **THEN** the system stages that set's poster and backdrop together as the item's pending selection

#### Scenario: Mix pieces across sets

- **WHEN** the user stages a poster from one set and a backdrop from a different set
- **THEN** the system keeps both as the item's pending selection independently of which set each came from

#### Scenario: Automatic selection

- **WHEN** the user requests automatic selection for an item or a bulk set of items
- **THEN** the system selects the primary poster from the newest available set for each item

### Requirement: Apply a selected cover via one or both methods

The system SHALL apply a selected cover using the method(s) chosen by the user: direct upload to the active media server, Kometa YAML export, or both. The method SHALL be selectable per apply action with a configurable default. The direct method SHALL route through the active media-server provider (Plex, Jellyfin, or Emby), not Plex specifically.

#### Scenario: Direct apply only

- **WHEN** the user applies a selection with the direct method
- **THEN** the system uploads the poster through the active media-server provider, locks the field, and records the application as method "server" with the provider's type

#### Scenario: Kometa export only

- **WHEN** the user applies a selection with the Kometa method
- **THEN** the system writes or updates Kometa-compatible YAML for the item without contacting the media server, and records the application as method "kometa"

#### Scenario: Both methods

- **WHEN** the user applies a selection with both methods
- **THEN** the system performs the direct upload via the active provider and writes the Kometa YAML, and records both outcomes independently so a partial failure is visible

### Requirement: Export Kometa-compatible YAML

The system SHALL generate Kometa/PMM-compatible metadata YAML containing `url_poster` (and `url_background` when a background is selected) keyed so Kometa applies it to the correct item, and SHALL write it into the configured Kometa assets/config directory.

#### Scenario: YAML written to mounted directory

- **WHEN** a Kometa export runs for one or more items
- **THEN** the system writes valid YAML entries pointing at the selected MediaUX asset URLs into the configured directory, ready for the next Kometa run

#### Scenario: Re-export updates existing entry

- **WHEN** a Kometa export runs again for an item that already has an entry
- **THEN** the system updates that item's entry in place rather than creating a duplicate

### Requirement: Record applied posters

The system SHALL record every applied cover with the item, the asset URL, the method(s) used, the outcome, and a timestamp, so history is queryable and re-application is detectable.

#### Scenario: Application recorded

- **WHEN** an apply action completes (success or failure)
- **THEN** the system stores a history record with item, URL, method, status, and timestamp

### Requirement: Apply a custom cover

The system SHALL let a user supply a custom cover for an item outside the discovered candidates, either by pasting an image URL or by uploading an image file. A URL-based custom cover SHALL be applicable via both the active media server and Kometa; an uploaded file SHALL be applicable via the active media server only, because a binary upload cannot be expressed as a Kometa YAML URL.

#### Scenario: Custom URL staged

- **WHEN** the user enters an image URL for the poster or background slot
- **THEN** the system stages that URL as the pending selection and allows applying it through the active media server and/or Kometa

#### Scenario: Uploaded file applied to the server

- **WHEN** the user uploads an image file for an item
- **THEN** the system uploads the bytes directly to the active media-server provider and records the application as method "server"

#### Scenario: Uploaded file not exportable to Kometa

- **WHEN** the user has staged an uploaded file (not a URL) and selects a method that includes Kometa
- **THEN** the system applies the upload to the active media server and omits it from Kometa export, making the limitation visible rather than writing an invalid YAML entry

### Requirement: Cross-provider auto-selection

Automatic selection SHALL operate across all providers' candidates for an item rather than only MediUX, choosing a primary poster (and where available a background) from the available providers using a deterministic preference order.

#### Scenario: Auto-select with multiple providers

- **WHEN** the user requests automatic selection for an item that has candidates from several providers
- **THEN** the system selects a primary poster from the available providers by a deterministic preference order and records it as the pending selection

#### Scenario: Auto-select falls back across providers

- **WHEN** the most-preferred provider has no poster candidate for the item
- **THEN** the system falls back to the next provider that does, rather than returning no selection

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

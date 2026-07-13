## MODIFIED Requirements

### Requirement: Select a candidate cover

The system SHALL let a user stage a pending selection for an item consisting of a poster and/or a background chosen from discovered candidates from any enabled artwork provider. The user SHALL be able to stage both pieces of one set at once ("use this set") or take an individual poster or background from any set. The system SHALL support automatic selection that independently chooses both a poster and, when available, a background using the configured deterministic scoring and provider preferences.

#### Scenario: Manual selection

- **WHEN** the user picks a specific poster or background candidate for an item
- **THEN** the system records that candidate and its provider provenance as the corresponding pending selection for the item

#### Scenario: Stage a whole set

- **WHEN** the user chooses "use this set" on a set that has both a poster and a backdrop
- **THEN** the system stages that set's poster and backdrop together as the item's pending selection

#### Scenario: Mix pieces across sets

- **WHEN** the user stages a poster from one set and a backdrop from a different set
- **THEN** the system keeps both as the item's pending selection independently of which set each came from

#### Scenario: Automatic selection

- **WHEN** the user requests automatic selection for an item or a bulk set of items
- **THEN** the system deterministically stages the best eligible poster and the best eligible background available for each item and leaves only unavailable slot kinds unset

### Requirement: Apply a selected cover via one or both methods

The system SHALL apply selected artwork using the method(s) chosen by the user: direct upload to the active media server, Kometa YAML export, or both. The method SHALL be selectable per apply action; when the action supplies no override, the system SHALL use the effective configured default after environment-over-persisted precedence. The direct method SHALL route through the selected media-server instance's provider (Plex, Jellyfin, or Emby), not Plex specifically. Every destination mutation SHALL use an explicitly confirmed exact plan, capture its prior state, and be verified afterward. Server and Kometa outcomes SHALL be recorded independently so a partial failure remains visible and retryable.

#### Scenario: Direct apply only

- **WHEN** the user confirms a selection with the direct method
- **THEN** the system captures the prior server artwork, uploads through the selected media-server provider, locks the field where supported, verifies the served result, and records the application as method "server" with the provider's type and instance

#### Scenario: Kometa export only

- **WHEN** the user confirms a selection with the Kometa method
- **THEN** the system captures the prior managed entry, writes or updates Kometa-compatible YAML without contacting the media server, verifies the persisted entry, and records the application as method "kometa"

#### Scenario: Both methods

- **WHEN** the user confirms a selection with both methods
- **THEN** the system performs and verifies the direct upload and Kometa write and records both outcomes independently so a partial failure is visible

#### Scenario: Configured default is used

- **WHEN** an apply action does not include an explicit method override
- **THEN** the system previews and applies using the effective configured default method shown to the user

#### Scenario: Explicit method overrides the default

- **WHEN** the user chooses a method for one apply action that differs from the configured default
- **THEN** the system uses the chosen method for that action without changing the persisted default

#### Scenario: Destination cannot be verified

- **WHEN** a destination accepts a write but its resulting artwork does not match the confirmed plan
- **THEN** the system records a verification failure for that destination and does not report it as successful

### Requirement: Export Kometa-compatible YAML

The system SHALL generate Kometa/PMM-compatible metadata YAML containing `url_poster` and `url_background` for the selected URL-backed slots, keyed so Kometa applies them to the correct item, and SHALL write it into the configured Kometa config directory. Each export SHALL follow the exact preview-and-confirm contract, preserve unrelated YAML content, create artwork revisions for affected entries, write atomically, and verify the persisted result.

#### Scenario: YAML written to mounted directory

- **WHEN** a confirmed Kometa export runs for one or more items
- **THEN** the system writes valid YAML entries pointing at the exact selected provider asset URLs into the configured directory, ready for the next Kometa run

#### Scenario: Re-export updates existing entry

- **WHEN** a confirmed Kometa export runs again for an item that already has an entry
- **THEN** the system captures the prior entry and updates that item's managed entry in place rather than creating a duplicate

#### Scenario: Unrelated YAML is preserved

- **WHEN** the metadata file contains user-authored entries or PosterPilot entries outside the confirmed plan
- **THEN** the system leaves those entries unchanged

### Requirement: Record applied posters

The system SHALL record every attempted poster or background application with the server instance and item, destination, artwork slot, asset URL or content identity, source provider and candidate/set identifiers when available, apply method, prior and resulting revision identifiers, outcome, verification result, error, initiating operation, and timestamp, so history is queryable and re-application is detectable.

#### Scenario: Application recorded

- **WHEN** an apply action completes with success, partial failure, or failure
- **THEN** the system stores destination-specific history with item, slot, provenance, method, before/after revisions, status, verification, error when present, and timestamp

#### Scenario: Custom artwork provenance is recorded

- **WHEN** the applied selection came from a custom URL or uploaded file
- **THEN** the history identifies it as custom and records a safe content identity without misattributing it to a discovered provider

### Requirement: Cross-provider auto-selection

Automatic selection SHALL operate across all enabled providers' candidates for an item rather than only MediUX. It SHALL independently score and choose a primary poster and, where available, a background using deterministic configured provider priority and scoring controls. The selected candidate and scoring inputs SHALL be included in the pending selection and preview so execution does not silently choose a different candidate.

#### Scenario: Auto-select with multiple providers

- **WHEN** the user requests automatic selection for an item that has poster and background candidates from several providers
- **THEN** the system deterministically stages the highest-ranked eligible poster and background and records each candidate's provider provenance

#### Scenario: Auto-select falls back across providers

- **WHEN** the most-preferred provider has no eligible candidate for one artwork kind
- **THEN** the system falls back to the next provider that has that kind without discarding a selection already made for the other artwork kind

#### Scenario: Background is unavailable

- **WHEN** eligible providers offer a poster but no background for an item
- **THEN** the system stages the poster, leaves the background unset, and reports that reason in the preview

### Requirement: Apply staged season and episode artwork

A single apply action SHALL plan and write every staged slot — show, seasons, and episodes — using the chosen method(s). For direct apply the system SHALL resolve each season/episode child on the selected media-server instance by number and upload to it; a staged slot with no matching child on the server SHALL be skipped and reported rather than failing the whole apply, and a single child's failure SHALL NOT abort the remaining slots. Every planned child mutation SHALL capture its prior snapshot and SHALL be verified independently after writing.

#### Scenario: Apply writes children directly

- **WHEN** the user confirms direct apply with season or episode slots staged
- **THEN** the system resolves each planned child by number, captures its prior artwork, uploads and locks its artwork, and verifies it alongside the show-level poster and background

#### Scenario: Staged slot has no matching child

- **WHEN** a staged season or episode number has no corresponding child on the selected media server
- **THEN** the system skips that slot, applies the rest, and reports the skipped slot in the plan result

#### Scenario: One child fails

- **WHEN** uploading or verifying one staged child's artwork fails
- **THEN** the system still applies the remaining staged slots and records the per-child failure independently

### Requirement: Record applied child artwork

The system SHALL record each attempted season/episode slot in artwork revision history with its destination, kind, season and (for episodes) episode number, source provenance, prior and resulting state, outcome, and verification result, so granular history is queryable and re-application and undo are scopeable. Show-level applications SHALL continue to be recorded with no season/episode.

#### Scenario: Child application recorded

- **WHEN** a season or episode slot is applied successfully or unsuccessfully
- **THEN** the history record includes destination, kind, season number, episode number when applicable, provenance, before/after state, status, verification, and timestamp

### Requirement: Revert applied artwork at full and per-season scope

The system SHALL support previewed and explicitly confirmed undo of all applied artwork for an item, a single season, a single slot, or an individual revision, independently for the server, Kometa, or both destinations. Undo SHALL use the immutable prior snapshot in artwork revisions and SHALL re-resolve season/episode children by number. Server undo SHALL write and verify the prior image rather than merely unlocking the field. Kometa undo SHALL restore or remove only the prior PosterPilot-managed values. A failure in one slot or destination SHALL NOT abort unrelated restorations and SHALL remain independently retryable.

#### Scenario: Revert all

- **WHEN** the user confirms undo for an item with full scope
- **THEN** the system restores the selected destinations for show-level artwork and every applied season and episode from their prior revision snapshots and verifies each result

#### Scenario: Revert a single season

- **WHEN** the user confirms undo for a specific season
- **THEN** the system restores only that season's poster/background and its episodes' title cards, leaving show-level artwork and other seasons in place

#### Scenario: Revert only Kometa

- **WHEN** the user confirms an undo scoped to the Kometa destination
- **THEN** the system restores the prior managed YAML values without changing artwork on the media server

#### Scenario: Direct restoration is unsupported

- **WHEN** a media-server field cannot be restored through the normal provider operation
- **THEN** the system reports an actionable failed undo for that slot and does not claim success based only on unlocking it

## ADDED Requirements

### Requirement: Preview an exact application plan before mutation

Every single-item and bulk artwork application SHALL first generate a side-effect-free server plan and SHALL require separate explicit confirmation before mutating a server or Kometa file. Plan generation SHALL run the same resolution, discovery, eligibility, scoring, child mapping, and default-method logic used by execution. The plan SHALL list every item, destination, slot, current-state identity, proposed candidate and provenance, skip reason, and expected overwrite. The confirmation token SHALL be single-use, expiring, and bound to the complete plan, source-state fingerprints, selected server instance, pending selections, and method. Execution SHALL use the frozen plan and SHALL NOT rediscover or substitute candidates.

#### Scenario: Bulk preview includes posters and backgrounds

- **WHEN** the user requests automatic bulk apply for items with eligible poster and background candidates
- **THEN** the preview lists the exact poster and background candidate planned for every item and all destinations that would change

#### Scenario: Confirmed plan executes unchanged

- **WHEN** the user confirms an unused plan whose source states and selections remain valid
- **THEN** the system attempts exactly the listed mutations, records each result, and does not add newly discovered work

#### Scenario: Candidate or current state changes before confirmation

- **WHEN** a pending selection, target artwork, server instance, or Kometa fingerprint changes after preview
- **THEN** the system rejects the stale confirmation and performs no mutation until a fresh plan is reviewed

#### Scenario: Preview has no eligible changes

- **WHEN** planning finds no eligible mutation for the requested scope
- **THEN** the system returns an empty plan with per-item reasons and issues no mutation confirmation

#### Scenario: Confirmation is replayed

- **WHEN** the same confirmation token is submitted more than once
- **THEN** the system rejects every submission after the first without reapplying artwork

### Requirement: Keep displayed artwork fresh after revisions

After a verified apply or undo, the system SHALL invalidate affected server-side and browser image caches and SHALL expose a revision-specific image identity or version so list, detail, comparison, and history views do not continue showing the prior thumbnail. Cache invalidation SHALL be scoped to the affected server instance, item, and artwork slot.

#### Scenario: Poster is applied while library view is open

- **WHEN** a poster apply is verified successfully
- **THEN** subsequent item data references a new image version and the library and detail views fetch the applied poster instead of a cached predecessor

#### Scenario: Season artwork is undone

- **WHEN** a season artwork undo is verified successfully
- **THEN** only the affected season slot receives a new image version and unrelated artwork remains cacheable

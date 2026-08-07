## ADDED Requirements

### Requirement: Separate preview URLs from destination asset URLs

The system SHALL distinguish an optimized preview URL from the canonical destination asset URL of an artwork candidate. Browser grids SHALL use the optimized preview URL. When a valid TMDB image candidate is frozen into an operation plan, its destination URL SHALL use TMDB's original-resolution asset. Direct media-server application, Kometa export, plan identity, verification, and revision history SHALL all use that same frozen destination URL.

The system SHALL NOT rewrite custom URLs, non-TMDB provider URLs, or URLs that merely resemble a TMDB URL but are not recognized as a trusted TMDB image asset.

#### Scenario: TMDB artwork is displayed during discovery

- **WHEN** the user browses a TMDB poster or background candidate
- **THEN** the browser loads an optimized preview rather than the original-resolution image

#### Scenario: TMDB artwork is applied directly

- **WHEN** a valid TMDB candidate is frozen into a direct media-server application plan
- **THEN** the planned and uploaded asset URL targets the original-resolution image

#### Scenario: TMDB artwork is exported to Kometa

- **WHEN** a valid TMDB candidate is frozen into a Kometa export plan
- **THEN** the YAML, verification expectation, and revision record use the same original-resolution URL

#### Scenario: Previously stored preview-sized candidate is planned

- **WHEN** an existing staged TMDB candidate contains only a recognized preview-sized TMDB URL
- **THEN** plan generation derives its original-resolution destination URL without requiring rediscovery

#### Scenario: Non-TMDB URL is applied

- **WHEN** selected artwork is a custom URL or comes from another provider
- **THEN** the system preserves its canonical destination URL exactly

### Requirement: Bind Kometa operations to an exact typed destination

Every Kometa preview SHALL identify each mutation by media kind, metadata filename, identifier namespace, mapping identifier, artwork slot, and current file fingerprint. Confirmation SHALL be bound to the exact destination files and fingerprints in the frozen plan. Kometa revisions SHALL retain the same typed destination identity and exact prior entry so verification and undo never infer a file or namespace from an untyped numeric identifier.

#### Scenario: Preview contains movie and show mutations

- **WHEN** a plan contains Kometa mutations for both media kinds
- **THEN** the preview identifies the exact movie and show files, namespaces, identifiers, prior values, and proposed values independently

#### Scenario: Target metadata file changes after preview

- **WHEN** a metadata file targeted by a plan changes before confirmation
- **THEN** the system rejects the stale confirmation and writes none of that plan's metadata mutations

#### Scenario: Unrelated metadata file changes after preview

- **WHEN** a metadata file not targeted by the plan changes before confirmation
- **THEN** that unrelated change does not invalidate the plan

#### Scenario: Undo typed Kometa entry

- **WHEN** the user confirms undo of a split-layout Kometa revision
- **THEN** the system restores or removes only the exact entry in the filename and namespace recorded by that revision

#### Scenario: Movie and show share a numeric identifier during undo

- **WHEN** a movie revision and show revision contain the same numeric identifier
- **THEN** undoing either revision leaves the other media kind's file and entry unchanged

#### Scenario: Undo a legacy revision

- **WHEN** a revision predates typed split destinations
- **THEN** the system targets its explicitly recorded legacy destination or reports that undo is unavailable when the destination cannot be proven and does not guess a split destination

## MODIFIED Requirements

### Requirement: Select a candidate cover

The system SHALL let a user stage a pending selection for an item consisting of a poster and/or background chosen from any eligible discovered provider candidate. The user SHALL be able to stage both pieces of one set at once or take an individual poster or background from any set. The system SHALL support deterministic automatic selection across eligible providers.

#### Scenario: Manual selection

- **WHEN** the user picks a specific poster or background candidate for an item
- **THEN** the system records that candidate as the corresponding pending selection for the item

#### Scenario: Stage a whole set

- **WHEN** the user chooses use-this-set on a set that has both a poster and backdrop
- **THEN** the system stages that set's poster and backdrop together as the item's pending selection

#### Scenario: Mix pieces across sets

- **WHEN** the user stages a poster from one set and a backdrop from a different set or provider
- **THEN** the system keeps both selections independently of their source sets

#### Scenario: Automatic selection

- **WHEN** the user requests automatic selection for an item or bulk set of items
- **THEN** the system stages the highest-ranked eligible candidate for each requested slot using the frozen ranking and language policy

### Requirement: Export Kometa-compatible YAML

The system SHALL generate Kometa-compatible metadata YAML containing `url_poster` and `url_background` for selected URL-backed slots and SHALL route every entry to an exact media-kind-specific destination. Movie entries SHALL be written to `posterpilot-movies.yml` using a Kometa-compatible TMDB identifier, falling back to IMDb only when TMDB is unavailable. Show entries SHALL be written to `posterpilot-shows.yml` using a Kometa-compatible TVDB identifier, falling back to IMDb only when TVDB is unavailable. Routing SHALL use the authoritative media-server item type rather than the matched artwork media type.

The two identifier namespaces and files SHALL remain independent even when their numeric values are equal. An item without an identifier supported by Kometa for its media kind SHALL be skipped with a visible reason rather than written under an incompatible identifier. Exports SHALL preserve unrelated YAML content, write atomically, capture revisions, and verify the exact persisted destination.

#### Scenario: Movie metadata is exported

- **WHEN** a confirmed Kometa export runs for a movie with a TMDB identifier
- **THEN** the system writes its selected destination URLs under that TMDB identifier in `posterpilot-movies.yml`

#### Scenario: Show metadata is exported

- **WHEN** a confirmed Kometa export runs for a show with a TVDB identifier
- **THEN** the system writes its selected destination URLs under that TVDB identifier in `posterpilot-shows.yml`

#### Scenario: Equal numeric identifiers remain independent

- **WHEN** a movie's TMDB identifier and a show's TVDB identifier have the same numeric value
- **THEN** both entries coexist in their respective files without overwriting or merging one another

#### Scenario: Provider match type disagrees with the media-server item

- **WHEN** a show is incorrectly matched by an artwork provider as a movie
- **THEN** the Kometa destination remains the show file and TVDB or IMDb namespace because routing uses the authoritative media-server item type

#### Scenario: Preferred identifier is unavailable

- **WHEN** the preferred identifier for an item's media kind is absent but its supported IMDb identifier is present
- **THEN** the system exports the entry using IMDb and records that namespace in the plan and revision

#### Scenario: No supported Kometa identifier is available

- **WHEN** an item has neither the preferred identifier nor a supported IMDb fallback
- **THEN** the system skips that Kometa mutation, reports the missing mapping identifier, and writes no knowingly unmatchable entry

#### Scenario: Re-export updates only the typed entry

- **WHEN** an item already has an entry in its media-kind-specific file
- **THEN** the system updates that entry in place without changing the other metadata file or creating a duplicate

### Requirement: Cross-provider auto-selection

Automatic selection SHALL operate across all eligible providers' candidates for an item. It SHALL rank candidates deterministically, apply the active TMDB artwork-language policy before ordinary TMDB candidate scoring, and use canonical provider order only as the provider tie-break after scores are equal. If no preferred-language or explicitly untagged TMDB candidate exists, a foreign-language fallback SHALL be explicit in the selection result and SHALL never appear as a hidden suggestion.

#### Scenario: Auto-select with multiple providers

- **WHEN** the user requests automatic selection for an item with eligible candidates from several providers
- **THEN** the system selects the highest-ranked candidate using the frozen scoring, language, and tie-break policy and records it as pending

#### Scenario: Preferred language outranks a foreign TMDB candidate

- **WHEN** an eligible preferred-language TMDB poster exists alongside a higher-scoring foreign-language TMDB poster
- **THEN** automatic selection does not select the foreign-language poster

#### Scenario: Language fallback is required

- **WHEN** no preferred-language or explicitly untagged TMDB poster exists and a foreign-language TMDB candidate is selected
- **THEN** the selection result identifies that language fallback occurred and the UI makes that selected candidate visible

#### Scenario: Auto-select falls back across providers

- **WHEN** the most-preferred provider has no eligible poster candidate for the item
- **THEN** the system considers eligible candidates from other providers rather than returning no selection solely because of provider order

#### Scenario: Provider scores are tied

- **WHEN** eligible candidates from different providers otherwise have equal ranking
- **THEN** the provider appearing first in canonical provider order wins the tie

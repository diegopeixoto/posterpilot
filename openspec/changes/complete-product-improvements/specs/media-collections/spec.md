## ADDED Requirements

### Requirement: Discover and persist server-scoped collections

The system SHALL discover movie collections and franchises from the selected media server's native collection membership and from TMDB collection identifiers attached to resolved titles. It SHALL normalize each collection under a stable source-qualified identifier, persist membership by PosterPilot server instance and media item identifier, record whether membership came from the server, TMDB, or both, and refresh membership during sync without merging unrelated same-named collections. A title that lacks a usable collection identifier SHALL remain in the library and SHALL NOT be assigned by title similarity alone.

#### Scenario: Native collection is discovered

- **WHEN** a media-server sync returns a native collection with member items
- **THEN** the system stores the collection under that server instance with its native identifier and associates only the returned member identifiers

#### Scenario: TMDB franchise is discovered

- **WHEN** resolved movie items share a TMDB collection identifier
- **THEN** the system creates or updates a TMDB-sourced franchise for that server and associates those items with source provenance

#### Scenario: Same collection name exists on two servers

- **WHEN** two configured servers each expose a collection with the same display name
- **THEN** the system stores separate server-scoped collection identities and never combines membership solely because the names match

#### Scenario: Membership disappears on refresh

- **WHEN** a subsequent authoritative sync no longer reports a source-specific membership
- **THEN** the system removes that source association, retains another still-valid source association if present, and keeps item and artwork history intact

#### Scenario: Item has no collection identifier

- **WHEN** an item title resembles a franchise member but neither its server metadata nor TMDB resolution supplies a collection identifier
- **THEN** the system leaves it ungrouped and does not infer membership from the title alone

### Requirement: Collection consistency overview

The system SHALL provide a collection index and image-forward collection detail view for the selected server. The detail view SHALL show the collection's provenance, member count, missing or unresolved members known from TMDB when available, each local member's current poster and background, staged artwork, provider and set provenance, and whether the member differs from the dominant reviewed visual family. Consistency indicators SHALL be explainable and SHALL distinguish missing data from a deliberate mismatch; they SHALL NOT change artwork automatically.

#### Scenario: Open a collection

- **WHEN** the user opens a discovered collection
- **THEN** the system shows only members belonging to that collection on the selected server, with current and staged artwork and available provenance

#### Scenario: Mixed artwork family is detected

- **WHEN** reviewed members use different provider/set families or a member lacks the artwork slot used by the rest of the set
- **THEN** the view flags the affected members and explains the evidence behind the inconsistency without applying a replacement

#### Scenario: Provenance is unknown

- **WHEN** current server artwork predates PosterPilot and has no known provider or set provenance
- **THEN** the view labels provenance unknown rather than classifying the image as belonging to a guessed family

#### Scenario: TMDB collection has unavailable members

- **WHEN** TMDB identifies franchise members that are not present in the selected server's synced libraries
- **THEN** the view may list them as unavailable context but excludes them from selection, apply, and consistency completion counts

### Requirement: Coordinated collection artwork suggestions

The system SHALL let the user request coordinated poster and background suggestions for a collection. It SHALL group candidates by verifiable provider, set, language, and design-family metadata when available, rank groups by configurable coverage and artwork scoring, show how many local members each group covers, and leave uncovered members explicit. Selecting a suggested group SHALL stage its candidate for each covered member while allowing any member slot to be overridden or cleared independently. The system SHALL NOT fabricate a shared family when candidates lack common provenance.

#### Scenario: One family covers every member

- **WHEN** a candidate family contains an eligible poster for every local collection member
- **THEN** the system presents it with complete coverage and can stage the corresponding candidates for all members in one review action

#### Scenario: Suggested family has partial coverage

- **WHEN** the highest-ranked verifiable family lacks candidates for some local members
- **THEN** the system reports the exact covered and uncovered members and stages only covered slots after the user selects it

#### Scenario: User overrides one member

- **WHEN** a coordinated family is staged and the user selects a different candidate for one member
- **THEN** only that member's staged slot changes and the remaining coordinated selections retain their provenance

#### Scenario: No common family metadata exists

- **WHEN** candidates exist but none share verifiable family or set provenance across members
- **THEN** the system offers per-member review without claiming that the candidates form a coordinated set

### Requirement: Review and apply a collection plan safely

The system SHALL turn staged collection artwork into an exact immutable preview listing every server instance, collection and member identifier, artwork slot, current snapshot, selected candidate and provenance, target (media server and/or Kometa), planned write, skip, and validation error. The plan SHALL require explicit confirmation bound to its content before execution, SHALL honor the configured application method, and SHALL never auto-apply because a family was suggested. Execution SHALL reuse artwork revision and verification behavior, continue independent member operations after a partial failure, and return per-member and aggregate outcomes.

#### Scenario: Preview coordinated application

- **WHEN** the user requests application for staged collection members
- **THEN** the system shows the exact writes and skips for every member and target and performs no mutation before confirmation

#### Scenario: Confirm unchanged plan

- **WHEN** the user confirms the same unexpired collection plan
- **THEN** the system applies only the listed operations, records a revision for each attempted artwork slot, verifies successful server writes, and reports per-member outcomes

#### Scenario: Collection state changes after preview

- **WHEN** membership, a selected candidate, target configuration, or current artwork changes after preview
- **THEN** the confirmation is rejected and the system requires a fresh plan showing the new state

#### Scenario: One member fails

- **WHEN** applying one member's artwork fails but other planned member writes are independent
- **THEN** the system records that failure with its revision outcome, continues the independent writes, and reports the collection action as partially successful

#### Scenario: Member belongs to another server

- **WHEN** a crafted or stale plan contains a member identifier outside the collection's server scope
- **THEN** validation rejects that operation before execution and no cross-server write occurs

### Requirement: Collection-level artwork where supported

When a media-server provider exposes a native collection entity and supports collection poster or background operations, the system SHALL sync its current collection artwork and offer collection-level candidates, preview, confirmed application, verification, and revision-based undo using the same safety contract as item artwork. When the provider does not support a slot or no native entity exists, the UI SHALL report that capability as unavailable and SHALL continue to support coordinated member artwork.

#### Scenario: Provider supports native collection artwork

- **WHEN** the selected server exposes a native collection with writable poster and/or background slots
- **THEN** the collection view shows those supported slots and routes any selected write through preview, confirmation, revision capture, and verification

#### Scenario: Provider lacks native collection artwork

- **WHEN** the selected provider cannot write artwork to native collection entities
- **THEN** the system disables only the collection-level slots with a capability explanation and leaves member coordination available

### Requirement: Undo collection artwork changes

The system SHALL let the user undo a completed collection action as a group or undo an individual collection/member artwork revision. Undo SHALL restore the immutable pre-action snapshot independently for each selected target, generate a new revision rather than deleting history, preview every restoration and skip, and report partial failures without rolling back successful independent restorations.

#### Scenario: Preview group undo

- **WHEN** the user requests undo for a completed collection application
- **THEN** the system previews the original snapshots that can be restored for each affected slot and identifies slots that were skipped, already restored, or are unavailable

#### Scenario: Confirm group undo

- **WHEN** the user confirms an unchanged group-undo preview
- **THEN** the system attempts each listed restoration, verifies supported server targets, writes new undo revisions, and reports aggregate and per-slot results

#### Scenario: Undo one member only

- **WHEN** the user selects one member revision from collection history
- **THEN** the system restores only that revision's selected target and leaves other collection members unchanged

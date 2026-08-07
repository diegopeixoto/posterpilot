## ADDED Requirements

### Requirement: Derive coverage from canonical media identity and occurrences

The system SHALL relate artwork coverage across known copies of a title using a canonical identity composed of authoritative media kind and resolved TMDB ID, while retaining each concrete server, library, and media-item occurrence. Movie and show identities SHALL remain distinct even when their numeric identifiers match. An unresolved item SHALL NOT be related to another item by title alone.

#### Scenario: Same title occurs in multiple libraries

- **WHEN** multiple active media items share the same authoritative media kind and resolved TMDB ID
- **THEN** the system relates them under one canonical identity while preserving the server and library provenance of every occurrence

#### Scenario: Numeric movie and show IDs collide

- **WHEN** a movie and show have the same numeric TMDB ID
- **THEN** the system keeps them as separate canonical identities and does not share coverage between them

#### Scenario: Item is unresolved

- **WHEN** an item lacks a resolved canonical identity
- **THEN** the system retains only evidence attached directly to that occurrence and does not infer cross-library coverage from its title or year

### Requirement: Represent coverage per destination and artwork slot

The system SHALL derive coverage independently for every known occurrence, destination, and artwork slot. Direct media-server evidence SHALL distinguish currently verified application, recorded but unverified application, external change, absence, and unknown state. Kometa evidence SHALL distinguish current metadata export, absence, and unknown state. Coverage for one slot or destination SHALL NOT imply coverage for another.

#### Scenario: Direct application is verified

- **WHEN** a successful direct revision's expected artwork fingerprint matches the current verified server artwork for a slot
- **THEN** that occurrence and slot are covered as applied on that server

#### Scenario: Direct application is unverified or changed

- **WHEN** a direct revision exists but current server artwork cannot be verified or no longer matches
- **THEN** coverage reports unverified or externally changed rather than currently applied

#### Scenario: Kometa metadata exists

- **WHEN** the current compatible Kometa metadata file contains a valid entry and URL for a slot
- **THEN** that canonical identity and slot are covered as exported to Kometa

#### Scenario: Kometa export does not prove downstream apply

- **WHEN** a valid Kometa metadata entry exists but no independent evidence shows that Kometa executed
- **THEN** the system does not report the slot as applied on any media server

#### Scenario: Partial slot coverage

- **WHEN** an item has poster evidence but no background evidence at a destination
- **THEN** poster coverage is present and background coverage remains absent or unknown independently

### Requirement: Reconcile current coverage without rewriting history

The system SHALL reconcile current coverage from immutable revisions, current media-server verification, and safely parsed current Kometa destinations. Reconciliation SHALL be read-only with respect to destination artwork and SHALL NOT erase or rewrite historical application records when current evidence changes.

#### Scenario: Kometa entry changes or is removed

- **WHEN** the current typed metadata file no longer contains a previously observed entry or slot
- **THEN** current Kometa coverage is updated while prior export history remains intact

#### Scenario: Kometa metadata cannot be parsed

- **WHEN** a relevant metadata file cannot be read or parsed reliably
- **THEN** affected Kometa coverage becomes unknown and no title is classified as uncovered or complete from that failed read

#### Scenario: Legacy metadata has provable identity

- **WHEN** a legacy `posterpilot.yml` entry can be tied to an exact media kind and item through retained destination or revision provenance
- **THEN** it may contribute legacy metadata coverage without being reinterpreted through an untyped numeric key

#### Scenario: Legacy metadata is ambiguous

- **WHEN** a legacy entry cannot be tied safely to one media kind and canonical identity
- **THEN** its coverage is unknown and the system does not assign it to a movie or show

#### Scenario: Coverage reconciliation runs

- **WHEN** the system refreshes coverage after sync, apply, undo, migration, or destination inspection
- **THEN** it changes no server artwork, Kometa metadata, manual match, or reviewed-state value solely as part of reconciliation

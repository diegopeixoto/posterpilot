## MODIFIED Requirements

### Requirement: Cross-provider auto-selection

Automatic selection SHALL operate across all providers' candidates for an item, choosing a primary
poster (and where available a background) using a configurable **scoring model** (provider weight,
image resolution, and aspect-ratio fit) rather than a flat preference order. The highest-scored
candidate per slot is chosen. Selection SHALL occur only on explicit user action and SHALL exclude
ignored items.

#### Scenario: Auto-select with multiple providers

- **WHEN** the user requests automatic selection for an item that has candidates from several providers
- **THEN** the system scores all candidates and records the highest-scored poster (and background where available) as the pending selection

#### Scenario: Auto-select falls back across providers

- **WHEN** the highest-weighted provider has no usable poster candidate for the item
- **THEN** scoring still yields the best available candidate from another provider rather than returning no selection

#### Scenario: Ignored items excluded

- **WHEN** automatic selection runs across the library
- **THEN** items marked ignored are skipped

## ADDED Requirements

### Requirement: Dry-run apply preview

The system SHALL provide a dry-run mode for poster apply that reports exactly what would be uploaded,
locked, and/or exported per slot — without performing any media-server write, Kometa export, or
applied-record persistence.

#### Scenario: Preview a single item

- **WHEN** the user requests a dry-run apply for an item with staged selections
- **THEN** the system returns the planned operations per slot (target child, image, method, and any skipped slots with reasons) and makes no changes to the server, files, or database

#### Scenario: Preview a bulk apply

- **WHEN** the user requests a dry-run before a bulk apply
- **THEN** the system returns an aggregate plan (counts of planned uploads, exports, and skips) for confirmation, without applying anything

### Requirement: Suggested selection from scoring

The system SHALL pre-select the highest-scored candidate per slot as a suggestion that the user can
override, and SHALL never apply a suggestion without explicit user confirmation.

#### Scenario: Suggestion pre-selected

- **WHEN** candidates with scores exist for an item and suggested pre-selection is enabled
- **THEN** the top-scored candidate per slot is shown as the pre-selected suggestion, clearly marked as suggested and overridable

#### Scenario: Suggestion never auto-applies

- **WHEN** a suggestion is pre-selected
- **THEN** nothing is applied to the media server or exported until the user explicitly triggers apply

### Requirement: Ignored items are excluded from apply and discovery

The system SHALL skip items marked ignored when discovering candidates and when applying posters.

#### Scenario: Ignored item skipped on apply

- **WHEN** a bulk apply or discovery runs over the library
- **THEN** items marked ignored are not processed

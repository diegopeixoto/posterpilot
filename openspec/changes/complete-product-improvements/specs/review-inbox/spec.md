## ADDED Requirements

### Requirement: Build a persistent review inbox

The system SHALL maintain a persistent, server- and library-scoped review inbox containing each item that requires a user decision. An item SHALL enter or update its inbox entry after synchronization, TMDB resolution, artwork discovery, application, verification, or detection of an external artwork change, and SHALL carry exactly one actionable state: `new`, `unresolved`, `no_candidates`, `suggestion_ready`, `staged`, `partial_failure`, `externally_changed`, `ignored`, or `completed`. Updating an entry SHALL preserve its review history and SHALL NOT automatically apply artwork.

#### Scenario: Newly synchronized item enters review

- **WHEN** synchronization imports an item that has not previously been reviewed
- **THEN** the system creates a `new` inbox entry scoped to the item's server and library without applying artwork

#### Scenario: Discovery updates the actionable state

- **WHEN** discovery finishes for an inbox item
- **THEN** the system changes the entry to `suggestion_ready` when candidates are available or `no_candidates` when all enabled providers return successfully with no candidates

#### Scenario: Resolution failure remains actionable

- **WHEN** an item cannot be resolved to TMDB
- **THEN** the system keeps the item in the inbox as `unresolved` with the recorded resolution reason and a manual-match action

#### Scenario: Review history survives later synchronization

- **WHEN** a previously reviewed item is encountered by a later synchronization
- **THEN** the system updates its inbox data without erasing prior decisions, ignore state, or review-history events

### Requirement: Represent review exceptions explicitly

The system SHALL distinguish a partial apply failure and an externally changed artwork state from ordinary pending review. Each exception entry SHALL identify the affected artwork slots and targets, retain the last successful selection, and expose an appropriate retry, compare, or accept-current action.

#### Scenario: Some artwork slots fail

- **WHEN** an apply operation succeeds for at least one staged slot and fails for at least one other staged slot
- **THEN** the inbox entry becomes `partial_failure`, identifies each successful and failed slot and target, and offers retry only for the failed work

#### Scenario: Artwork changes outside PosterPilot

- **WHEN** synchronization observes current server artwork that differs from the last verified PosterPilot revision
- **THEN** the inbox entry becomes `externally_changed` and offers comparison plus explicit actions to accept the server state or stage another revision

### Requirement: Query and save review views

The system SHALL query the review inbox using server-side search, state, server, library, media-type, provider-availability, and changed-since filters together with a deterministic sort. It SHALL return the total number of matching entries independently of page size. The user SHALL be able to save, rename, update, and delete named views containing those filters and sort settings.

#### Scenario: Filtered total exceeds the current page

- **WHEN** a review query matches more entries than fit on one page
- **THEN** the system returns the requested page and the total matching count computed across the full filtered result set

#### Scenario: Saved view is reopened

- **WHEN** the user opens a named saved view
- **THEN** the system restores its persisted filters and sort and queries the current inbox data using them

#### Scenario: Saved view is updated

- **WHEN** the user changes the filters or sort of a saved view and confirms an update
- **THEN** the system replaces that view's persisted query definition without changing any inbox entry

### Requirement: Preserve review context across item navigation

The system SHALL create a stable ordered review context for the active inbox query and SHALL preserve its saved-view identity or filters, sort, page position, and focused item while the user opens item detail. Item detail SHALL expose previous, next, and return-to-inbox navigation within that context, skipping entries that no longer match while the review is in progress.

#### Scenario: Return to the same inbox position

- **WHEN** the user opens an item from the inbox and returns without changing its review state
- **THEN** the system restores the same query, scroll or page position, and focused entry

#### Scenario: Navigate to the next matching item

- **WHEN** the user activates next from item detail
- **THEN** the system opens the next entry in the stable review order while retaining the active view and filters

#### Scenario: Current entry leaves the active view

- **WHEN** an action changes the current entry so it no longer matches the active filters
- **THEN** previous and next navigation continue from its former position using the nearest remaining matching entry

### Requirement: Support accessible keyboard review

The system SHALL provide documented keyboard actions for previous item, next item, accept suggestion, ignore, compare, and apply-and-next. Keyboard actions SHALL use the same validation and confirmation paths as visible controls, SHALL be operable without requiring pointer input, and SHALL not fire while focus is in an editable control or while an unrelated modal dialog is active.

#### Scenario: Keyboard action reviews an item

- **WHEN** focus is outside an editable control and the user invokes a documented review shortcut
- **THEN** the system performs the corresponding visible review action through the same validation and announces the result to assistive technology

#### Scenario: User is editing text

- **WHEN** focus is in an input, textarea, select, or content-editable control
- **THEN** review shortcuts do not intercept the user's keystrokes

### Requirement: Compare current, suggested, and staged artwork

The review flow SHALL provide a comparison for every applicable artwork slot showing the current server image, the suggested candidate when available, and the staged selection when it differs. The comparison SHALL label provider, target, and stale or unavailable state and SHALL allow the user to stage individual pieces or a complete candidate set without applying it.

#### Scenario: Suggested set is compared with current artwork

- **WHEN** the user opens compare for an entry with a ranked suggestion
- **THEN** the system displays current and suggested artwork side by side for each available slot with provider and target labels

#### Scenario: User stages only one slot

- **WHEN** the user selects a different candidate for one slot in comparison
- **THEN** the system persists that staged slot without changing or applying the other slots

### Requirement: Apply and advance only after a verified outcome

The review flow SHALL offer an apply-and-next action that submits the staged selection through the normal preview and confirmation contract, waits for the apply operation and post-write verification to reach a terminal outcome, and advances only after every selected target succeeds. On failure or partial failure, the system SHALL remain on the current entry and expose the recorded error and retry action.

#### Scenario: Apply and next succeeds

- **WHEN** the user confirms apply-and-next and every staged target is applied and verified
- **THEN** the system marks the entry `completed` and opens the next entry in the active review context

#### Scenario: Apply and next fails

- **WHEN** any staged target fails to apply or verify
- **THEN** the system does not advance, records the appropriate failure state, and shows the failed target and retry action

#### Scenario: Nothing is staged

- **WHEN** the user invokes apply-and-next with no staged artwork
- **THEN** the system refuses the operation and identifies that at least one artwork slot must be staged

### Requirement: Provide actionable review summaries

The system SHALL provide summary counts for pending decisions and exception states across the current server scope and per library. A summary SHALL link to a corresponding filtered inbox query and SHALL be updated after relevant jobs and review actions reach terminal states.

#### Scenario: Pending summary opens the inbox

- **WHEN** the user activates a summary showing items ready for review
- **THEN** the system opens the inbox filtered to the entries represented by that summary

#### Scenario: Review action updates counts

- **WHEN** an entry moves from a pending state to `completed` or `ignored`
- **THEN** the system removes it from the pending count and updates all affected summaries

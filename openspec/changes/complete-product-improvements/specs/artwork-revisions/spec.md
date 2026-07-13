## ADDED Requirements

### Requirement: Capture immutable original artwork snapshots

Before the first PosterPilot mutation of an artwork slot, the system SHALL capture an immutable original snapshot scoped by server instance, media item, destination (`server` or `kometa`), artwork kind, and season/episode identity when applicable. A server snapshot SHALL retain sufficient image data and metadata to restore the exact prior artwork without depending on a remote URL remaining available. A Kometa snapshot SHALL retain the exact prior managed YAML value or the fact that no managed value existed. Later library synchronizations, external artwork changes, applications, and undo operations SHALL NOT overwrite the original snapshot.

#### Scenario: Capture server original before first apply

- **WHEN** PosterPilot is about to mutate a server artwork slot for which no original snapshot exists
- **THEN** the system stores a restorable copy of the currently served artwork and its identifying metadata before performing the mutation

#### Scenario: Capture an absent Kometa value

- **WHEN** PosterPilot is about to add a managed Kometa artwork value that did not previously exist
- **THEN** the system records absence as the original state before adding the value

#### Scenario: Synchronization does not replace the original

- **WHEN** a library synchronization observes different current artwork after an original snapshot has been captured
- **THEN** the system updates the observed-current state without changing the immutable original snapshot

### Requirement: Record append-only artwork revisions

The system SHALL append a revision for every attempted artwork mutation and undo. Each revision SHALL identify the server instance, media item, destination, artwork kind and child scope, prior and proposed states, source provider and candidate provenance when applicable, apply method, initiating operation, timestamp, outcome, verification result, and any error. Revision records SHALL be retained when a later action is undone and SHALL NOT be rewritten to make failed or reverted operations appear successful.

#### Scenario: Successful candidate apply is recorded

- **WHEN** a discovered candidate is successfully applied and verified
- **THEN** the system appends a revision containing the candidate provenance, before and after states, successful destination outcome, and verification evidence

#### Scenario: Failed mutation is retained

- **WHEN** a destination write fails or cannot be verified
- **THEN** the system appends a failed revision with the error and leaves earlier revisions unchanged

#### Scenario: Undo creates another revision

- **WHEN** the user undoes a prior revision
- **THEN** the system appends an undo revision linked to the revision being reversed instead of deleting or rewriting history

### Requirement: Verify destination state after mutation

The system SHALL verify every successful-looking artwork mutation by reading the affected destination again. For a media server, verification SHALL compare the served artwork or a stable server image identity with the intended image after bypassing stale thumbnail caches. For Kometa, verification SHALL parse the file written to disk and confirm the intended managed entry. An unverified or mismatched result SHALL be reported as a failure or partial failure and SHALL NOT be represented as verified success.

#### Scenario: Server write matches the intended image

- **WHEN** the server accepts an artwork upload and the subsequent uncached read matches the intended image
- **THEN** the revision is marked successful and verified

#### Scenario: Server acknowledges but serves different artwork

- **WHEN** the server accepts an upload request but the subsequent uncached read does not match the intended image
- **THEN** the system records a verification failure and exposes the destination as failed rather than successful

#### Scenario: Kometa write is verified

- **WHEN** a Kometa metadata mutation completes
- **THEN** the system reparses the persisted YAML and marks the revision verified only if the intended managed entry is present exactly as planned

### Requirement: Present revision history by scope and destination

The system SHALL expose a chronological artwork history for an item, including show/movie, season, and episode scopes and independent server and Kometa outcomes. The history SHALL distinguish original snapshots, successful applications, partial or failed applications, external-state observations, and undo operations, and SHALL redact credentials and sensitive filesystem details.

#### Scenario: Item timeline is requested

- **WHEN** the user opens artwork history for an item
- **THEN** the system returns its revisions in chronological order with scope, destination, provenance, verification state, and undo availability

#### Scenario: Partial multi-destination apply is shown

- **WHEN** a combined server-and-Kometa apply succeeds for one destination and fails for the other
- **THEN** the history displays the two destination outcomes independently under the same initiating operation

### Requirement: Undo a revision per destination and scope

The system SHALL let the user preview and explicitly confirm undo for an individual revision, destination, artwork slot, season, or full item. Server undo SHALL restore the exact prior snapshot by writing it back and verifying it; it SHALL NOT rely only on unlocking a media-server field. Kometa undo SHALL restore the prior managed YAML value or remove the managed value when the prior state was absent, without disturbing user-authored siblings. An undo SHALL affect only the selected scope and destination and SHALL report partial failures independently.

#### Scenario: Restore an exact server snapshot

- **WHEN** the user confirms undo for a server poster revision
- **THEN** the system writes the prior captured image back to that server slot, preserves unrelated slots, and verifies the restored result

#### Scenario: Remove a newly added Kometa value

- **WHEN** the user confirms undo for a Kometa revision whose prior state was absent
- **THEN** the system removes only PosterPilot's managed value and preserves all user-authored YAML content

#### Scenario: Undo one season only

- **WHEN** the user confirms undo scoped to one season
- **THEN** the system restores that season's selected destinations and slots without changing show-level artwork or other seasons

#### Scenario: One destination fails during combined undo

- **WHEN** a combined server-and-Kometa undo restores one destination but fails on the other
- **THEN** the system retains the successful restoration, records both outcomes, and offers retry only for the failed destination

### Requirement: Reject unsafe or stale undo plans

Every undo SHALL be based on a server-issued preview that identifies the exact revision, current destination fingerprint, restoration state, and affected scope. Confirmation SHALL be single-use and SHALL be rejected when the current state or selected scope no longer matches the preview, requiring the user to review a fresh plan.

#### Scenario: Destination changed after undo preview

- **WHEN** the destination artwork changes after an undo preview is issued and before it is confirmed
- **THEN** the system rejects the stale confirmation and performs no restoration

#### Scenario: Undo preview is confirmed unchanged

- **WHEN** the user confirms an unused undo preview and its destination fingerprint is unchanged
- **THEN** the system performs exactly the restoration shown in the preview and no other mutation

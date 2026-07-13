## ADDED Requirements

### Requirement: Record per-provider discovery outcomes

The system SHALL persist an outcome for every provider considered in each discovery run. An outcome SHALL identify the item, provider, run, start and completion times, latency, status, candidate count, whether retained stale candidates were served, and a sanitized error category and message when applicable. Status SHALL distinguish at least `succeeded`, `empty`, `disabled`, `missing_credential`, `timed_out`, and `failed`.

#### Scenario: Provider returns candidates

- **WHEN** an enabled provider completes discovery with one or more candidates
- **THEN** the system records a `succeeded` outcome with latency and the number of candidates returned

#### Scenario: Provider returns no candidates

- **WHEN** an enabled provider completes successfully with no candidates
- **THEN** the system records an `empty` outcome rather than treating the provider as failed

#### Scenario: Provider is not queried

- **WHEN** a provider is disabled or lacks a required credential
- **THEN** the system records `disabled` or `missing_credential` respectively with zero candidates and no request latency

#### Scenario: Provider fails

- **WHEN** a provider times out or returns an error or unparseable response
- **THEN** the system records `timed_out` or `failed` with a sanitized error and whether last-known-good candidates were retained

### Requirement: Distinguish aggregate and provider-specific availability

The system SHALL derive aggregate candidate availability from active candidates across every enabled provider and SHALL derive MediUX availability only from active MediUX candidates. UI filters, counts, badges, and review states SHALL use the matching value and SHALL NOT treat candidates from another provider as MediUX availability.

#### Scenario: Only TMDB has candidates

- **WHEN** an item has active TMDB artwork candidates and no active MediUX candidates
- **THEN** aggregate availability is true and MediUX availability is false

#### Scenario: MediUX has candidates

- **WHEN** an item has at least one active MediUX candidate
- **THEN** both aggregate availability and MediUX availability are true

#### Scenario: Only stale candidates remain

- **WHEN** an item has retained last-known-good candidates after a transient provider failure
- **THEN** the corresponding availability remains true and is marked stale so consumers can disclose its freshness

## MODIFIED Requirements

### Requirement: Multi-provider discovery

The system SHALL discover candidates for a title by fanning out across all enabled and credentialed providers, merging their results into the item's candidate list, tagging each candidate with the provider it came from, and persisting a separate outcome for every provider considered in the run. Completion of the aggregate discovery SHALL wait until each considered provider has succeeded, returned empty, been skipped for a known availability reason, timed out, or failed.

#### Scenario: Candidates merged across providers

- **WHEN** more than one provider is enabled and discovery runs for a title
- **THEN** the system queries each credentialed enabled provider, stores the union of their active candidate sets with provider tags, and records each provider's outcome independently

#### Scenario: Provider tag persisted

- **WHEN** a candidate is stored
- **THEN** its originating provider is recorded so the UI can group and label it

#### Scenario: Aggregate run reaches a terminal result

- **WHEN** every considered provider has reached a terminal outcome
- **THEN** the system completes discovery with the merged active candidates and exposes the outcome of every provider, including providers that returned none or were unavailable

### Requirement: Per-provider enablement

The system SHALL let the user enable or disable each provider, and SHALL only query enabled providers during discovery. Providers requiring credentials (Fanart.tv) SHALL be treated as unavailable when their credential is absent. Candidates retained from a disabled provider SHALL be excluded from active discovery results and availability counts until that provider is enabled and successfully queried again.

#### Scenario: Disabled provider skipped

- **WHEN** a provider is disabled
- **THEN** discovery does not query it, records a `disabled` outcome, and excludes its retained candidates from the active merged result

#### Scenario: Keyed provider without a key

- **WHEN** a provider that requires an API key is enabled but no key is configured
- **THEN** the system skips that provider, records a `missing_credential` outcome, and surfaces the condition without failing discovery

#### Scenario: Provider is re-enabled

- **WHEN** a previously disabled provider is enabled and a new discovery is requested
- **THEN** the system queries it and uses the new terminal outcome to determine whether that provider's candidates become active

### Requirement: Resilient discovery

The system SHALL isolate provider failures so that an error, timeout, or unparseable response from one provider does not prevent the others from returning candidates. On a transient provider failure, the system SHALL preserve that provider's last-known-good candidates for the same item and resolved TMDB identity, mark them stale with their last-success time, and expose the current failure. A later successful response, including a successful empty response, SHALL replace that provider's retained candidate set and clear the stale state.

#### Scenario: One provider fails without prior candidates

- **WHEN** one enabled provider errors or returns an unparseable response during discovery and has no last-known-good candidates for the item
- **THEN** the system records that provider's failure, stores no candidates for it, and still stores candidates from the providers that succeeded

#### Scenario: One provider fails with prior candidates

- **WHEN** one enabled provider fails transiently and has last-known-good candidates for the same item and TMDB identity
- **THEN** the system retains those candidates marked stale, records the current failure and prior last-success time, and still merges results from successful providers

#### Scenario: Provider later succeeds with candidates

- **WHEN** a provider with stale retained candidates later returns a successful candidate response
- **THEN** the system replaces its retained candidates with the new response and clears their stale state

#### Scenario: Provider later succeeds with no candidates

- **WHEN** a provider with stale retained candidates later completes successfully with no candidates
- **THEN** the system removes that provider's retained candidates, records an `empty` outcome, and updates availability accordingly

#### Scenario: Resolved identity changes

- **WHEN** an item's resolved TMDB identity changes before discovery
- **THEN** the system does not reuse last-known-good candidates associated with the previous identity

## ADDED Requirements

### Requirement: Configure persistent review-first automations

The system SHALL let the user create, edit, enable, disable, and delete named automations scoped to one or more server libraries. An automation SHALL specify a trigger, discovery inputs, optional saved review-view destination, and timezone. New automations SHALL default to review-only behavior: they SHALL synchronize and discover candidates into the review inbox and SHALL NOT apply artwork. PosterPilot SHALL NOT silently migrate an existing installation to an artwork-applying automation.

#### Scenario: Create a scheduled review automation

- **WHEN** the user saves an enabled automation for a library and a daily local time
- **THEN** the system persists the automation, its timezone, and its review-only action for execution after restarts

#### Scenario: New automation does not auto-apply

- **WHEN** the user creates an automation without choosing any advanced mutation behavior
- **THEN** the automation is saved as review-only and can only place discovered work in the review inbox

#### Scenario: Disabled automation is not executed

- **WHEN** an automation is disabled when its trigger becomes due
- **THEN** the system creates no execution job for that trigger

### Requirement: Support schedule and media-event triggers

The system SHALL support interval or calendar schedules and eligible media events such as completion of a library synchronization or discovery of newly added items. Calendar schedules SHALL be evaluated in the automation's configured IANA timezone, including daylight-saving transitions, and each logical occurrence SHALL execute at most once.

#### Scenario: Calendar occurrence becomes due

- **WHEN** an enabled calendar automation reaches its next local occurrence
- **THEN** the system enqueues one execution associated with that occurrence and calculates the following occurrence in the configured timezone

#### Scenario: Newly added media triggers review discovery

- **WHEN** an enabled event automation observes newly added items in one of its scoped libraries
- **THEN** the system enqueues discovery for those items and routes the resulting candidates or exceptions into the review inbox

#### Scenario: Service restarts across a due occurrence

- **WHEN** the service was unavailable at an automation's due time and restarts within its configured catch-up window
- **THEN** the system enqueues the missed occurrence once rather than skipping it or creating duplicates

### Requirement: Execute automations through durable background jobs

Each automation occurrence SHALL create or reuse a durable background job containing an immutable snapshot of the automation ID, trigger occurrence, server and library scopes, discovery inputs, and destination review view. Editing an automation after enqueue SHALL NOT alter that occurrence's payload. The automation execution SHALL report synchronization and discovery phases and SHALL link its resulting review items and failures to the occurrence.

#### Scenario: Automation is edited after enqueue

- **WHEN** the user changes an automation after one of its occurrences has been enqueued
- **THEN** the queued occurrence runs with its original payload and future occurrences use the edited configuration

#### Scenario: Execution populates the inbox

- **WHEN** an automation completes discovery for matching media items
- **THEN** the system records the occurrence result and makes the discovered, unmatched, candidate-less, and failed items available in its destination review view

### Requirement: Coalesce duplicate event work

The system SHALL derive an idempotency key from the automation, trigger occurrence or event identity, server, library, and affected media scope. It SHALL coalesce duplicate webhook deliveries and SHALL NOT enqueue an automation occurrence whose incompatible sync or discovery work is already queued or running for the same scope. Distinct scopes SHALL remain independently executable.

#### Scenario: Webhook is delivered twice

- **WHEN** the same eligible media event is delivered more than once
- **THEN** the system associates all deliveries with one automation occurrence and executes the affected work once

#### Scenario: Compatible libraries run independently

- **WHEN** two automation occurrences target different server-library scopes
- **THEN** the system permits both to run subject to the global concurrency limit

### Requirement: Retry transient automation failures safely

The system SHALL persist every automation attempt and SHALL retry transient failures using bounded exponential backoff with jitter. Retries SHALL reuse the occurrence idempotency key and SHALL resume only failed or unfinished work when safe. Permanent validation or authentication failures SHALL NOT be retried automatically, and an automation SHALL be paused after its configured consecutive-failure threshold.

#### Scenario: Provider times out transiently

- **WHEN** a discovery attempt fails with a retryable provider timeout and attempts remain
- **THEN** the system schedules a later attempt with backoff and preserves successful work from the earlier attempt

#### Scenario: Credentials are invalid

- **WHEN** an occurrence fails because required server or provider credentials are invalid
- **THEN** the system records a non-retryable failure, creates no automatic retry, and tells the user which configuration requires attention without exposing the credential

#### Scenario: Consecutive failure threshold reached

- **WHEN** an automation reaches its configured consecutive-failure threshold
- **THEN** the system pauses future occurrences and exposes a clear action to inspect the failure and re-enable the automation

### Requirement: Expose automation history and next actions

The system SHALL show each automation's enabled state, last and next occurrence, last-success time, consecutive failures, and occurrence history. Each occurrence SHALL expose linked job progress, item-level results, retries, and errors, with actions to retry failed work or open the resulting review view. All status and action text SHALL render in the active locale.

#### Scenario: User inspects a failed occurrence

- **WHEN** the user opens an automation occurrence that failed partially
- **THEN** the system shows successful and failed item counts, attempt history, redacted errors, and a retry-failed action

#### Scenario: User opens completed review work

- **WHEN** an occurrence completes with items requiring review
- **THEN** the system offers an action that opens the associated review view with those items selected by occurrence

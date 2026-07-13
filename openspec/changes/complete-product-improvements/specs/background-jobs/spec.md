## MODIFIED Requirements

### Requirement: Run library-wide operations as background jobs

The system SHALL execute long-running operations — including incremental and full library sync, bulk cover discovery, exact-plan bulk apply, failed-item retry, and scheduled automation work — as durable background jobs processed by an in-process worker queue, so the UI remains responsive and operations survive page navigation and service restarts. Before enqueue, the system SHALL persist the validated job type, immutable payload, server and library scope, idempotency key, initiator, and initial attempt. Work SHALL be divided into resumable phases and per-item units where the operation permits, and the worker SHALL use leases so abandoned running attempts can be recovered safely.

#### Scenario: Job enqueued and processed

- **WHEN** the user starts a library sync, full rescan, bulk operation, retry, or an automation becomes due
- **THEN** the system persists a job and its payload, returns immediately, and processes the work in the background

#### Scenario: Bounded concurrency

- **WHEN** multiple jobs or many per-item tasks are queued
- **THEN** the worker processes them within configured global and provider-specific concurrency limits rather than all at once

#### Scenario: Service restarts with queued work

- **WHEN** the service restarts while durable jobs are queued or have an expired running lease
- **THEN** the worker resumes queued work and safely recovers eligible unfinished attempts without losing their payloads

### Requirement: Persist job history

The system SHALL persist each job's type, immutable payload, server and library scope, idempotency key, status, phase, progress, structured per-item result summary, attempt records, redacted errors, initiator, and enqueue/start/finish timestamps so history is inspectable after restart. Every attempt SHALL record its number, trigger, lease and timing, result, retryability, and error. Terminal jobs SHALL retain sufficient result detail to retry only failed work without repeating successful mutations.

#### Scenario: History survives restart

- **WHEN** the service restarts after jobs have run
- **THEN** completed, partially failed, failed, cancelled, and retried jobs remain listed with their payload summary, final result, attempts, errors, and timestamps

#### Scenario: Interrupted job marked

- **WHEN** the service restarts after a running job's lease expires
- **THEN** the system marks that attempt interrupted, preserves its progress, and either enqueues a safe retry under policy or marks the job failed with an actionable reason rather than leaving it perpetually running

#### Scenario: Partial result is persisted

- **WHEN** some per-item work succeeds and other work fails
- **THEN** the system stores item-level outcome references and represents the job as partially failed rather than discarding successful results

## ADDED Requirements

### Requirement: Prevent incompatible duplicate jobs

The system SHALL derive a normalized conflict scope and idempotency key for each job from its type, server instance, library, media scope, trigger, and immutable operation inputs. It SHALL return or link to an existing equivalent queued or running job instead of enqueuing a duplicate, and SHALL reject or defer incompatible overlapping jobs that could race over the same mutable state. Read-only or differently scoped work SHALL remain concurrently eligible subject to bounded concurrency.

#### Scenario: Same sync is requested twice

- **WHEN** an equivalent library sync is requested while one is queued or running for the same server-library scope
- **THEN** the system returns the existing job identity and does not enqueue a second sync

#### Scenario: Apply conflicts with a rescan

- **WHEN** a bulk apply would overlap mutable item state currently owned by an incompatible full-rescan phase
- **THEN** the system rejects or defers the apply with a reference to the conflicting job instead of running both concurrently

#### Scenario: Different libraries do not conflict

- **WHEN** jobs target different server-library scopes and share no incompatible resources
- **THEN** the system allows both to be queued and processed subject to concurrency limits

### Requirement: Expose detailed failures and retry failed work

The system SHALL expose job-level and per-item errors, skip reasons, retryability, attempt history, and recommended next action without leaking credentials. The user SHALL be able to retry all retryable failures or a selected failed subset. A retry SHALL create a linked attempt or child job with an immutable payload containing only eligible failed or unfinished units, SHALL preserve previous successes, and SHALL reuse mutation idempotency protections. Cancelled work and permanent validation failures SHALL NOT retry automatically.

#### Scenario: User inspects a partial failure

- **WHEN** a bulk job completes with failed and successful items
- **THEN** the UI/API exposes independent counts and redacted details and offers retry for the eligible failed items only

#### Scenario: Retry failed subset

- **WHEN** the user retries selected retryable item failures
- **THEN** the system enqueues linked work for exactly that subset and does not repeat successful items

#### Scenario: Failure is not retryable

- **WHEN** an item failed because its request is invalid or required configuration is absent
- **THEN** the system records it as non-retryable and presents the configuration or input action needed instead of scheduling automatic retries

### Requirement: Support a true full library rescan

The system SHALL expose full rescan as a distinct job mode from incremental sync. A full rescan SHALL re-read every item in the selected server-library scope, refresh normalized server metadata and current artwork identities, re-evaluate resolution and candidate-discovery eligibility according to the request, and reconcile items removed from the source. It SHALL preserve immutable artwork originals and revision history and SHALL NOT apply artwork automatically.

#### Scenario: User starts full rescan

- **WHEN** the user confirms a full rescan for a library
- **THEN** the system enqueues a full-rescan job whose progress and results distinguish server read, reconciliation, resolution, and optional discovery phases

#### Scenario: Rescan observes changed artwork

- **WHEN** a full rescan finds artwork changed outside PosterPilot
- **THEN** the system refreshes observed current state and review status without overwriting the immutable original snapshot or past revisions

#### Scenario: Source item was removed

- **WHEN** a previously synchronized item is absent from the completed full server listing
- **THEN** the system marks or removes it according to retention policy without deleting its auditable revision history

### Requirement: Run scheduled work durably

The worker SHALL accept scheduled-automation occurrences as durable jobs, preserving the automation ID, logical occurrence, timezone, trigger event, and frozen execution inputs. It SHALL enforce occurrence idempotency, record each attempt, use the configured retry and backoff policy, and route discovered results to the review inbox without default artwork application.

#### Scenario: Scheduler enqueues an occurrence

- **WHEN** an enabled automation occurrence becomes due
- **THEN** the worker persists one job for that logical occurrence and processes its frozen review-first payload

#### Scenario: Duplicate occurrence is submitted

- **WHEN** the same automation occurrence is submitted again after a job already exists
- **THEN** the system returns the existing job and creates no duplicate execution

#### Scenario: Scheduled attempt fails transiently

- **WHEN** a scheduled job attempt fails with a retryable error and attempts remain
- **THEN** the system persists the failure and makes the next attempt eligible only after its calculated backoff

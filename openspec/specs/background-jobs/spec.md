# background-jobs Specification

## Purpose

Define asynchronous library operations, live progress reporting, cancellation, and persisted job history.

## Requirements

### Requirement: Run library-wide operations as background jobs

The system SHALL execute long-running operations (library sync, bulk cover discovery, bulk apply) as background jobs processed by an in-process worker queue, so the UI remains responsive and operations survive page navigation.

#### Scenario: Job enqueued and processed

- **WHEN** the user starts a library sync or a bulk operation
- **THEN** the system creates a job record, returns immediately, and processes the work in the background

#### Scenario: Bounded concurrency

- **WHEN** multiple jobs or many per-item tasks are queued
- **THEN** the worker processes them within a bounded concurrency limit rather than all at once

### Requirement: Stream live job progress

The system SHALL stream job progress to the UI using Server-Sent Events, reporting processed count, total count, current item, and status transitions.

#### Scenario: Progress updates delivered

- **WHEN** a job is running and the UI is subscribed
- **THEN** the system pushes incremental progress events (processed/total, current item) until the job completes or fails

#### Scenario: Reconnect mid-job

- **WHEN** the UI subscribes to a job that is already in progress
- **THEN** the system delivers the current progress snapshot and then continues streaming subsequent updates

### Requirement: Cancel a running job

The system SHALL allow the user to cancel a running job, stopping further per-item work and marking the job cancelled.

#### Scenario: Cancellation honored

- **WHEN** the user cancels a running job
- **THEN** the system stops scheduling new per-item work, marks the job cancelled, and records how many items were completed before cancellation

### Requirement: Persist job history

The system SHALL persist each job's type, status, progress, error (if any), and start/finish timestamps so history is available after restart.

#### Scenario: History survives restart

- **WHEN** the service restarts after jobs have run
- **THEN** the previously completed and failed jobs remain listed with their final status and timestamps

#### Scenario: Interrupted job marked

- **WHEN** the service restarts while a job was still running
- **THEN** that job is marked interrupted/failed rather than left perpetually "running"

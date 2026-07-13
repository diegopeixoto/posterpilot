## MODIFIED Requirements

### Requirement: Configuration documentation

The documentation site SHALL include a configuration page covering connecting and managing named Plex, Jellyfin, and Emby server instances; provider-specific authentication; the TMDB API key; artwork-provider credentials and scoring controls; the Kometa export and Plex-instance binding; default application method; review-first schedules; backup location and retention policy; and the full set of environment variables. It SHALL explain how environment variables relate to the in-app Settings UI, including which source takes precedence, which values are secrets, which values are global versus server-scoped, and which changes require a restart.

#### Scenario: Media servers, TMDB, providers, and Kometa documented

- **WHEN** a reader opens the configuration page
- **THEN** it documents adding and testing named Plex, Jellyfin, and Emby instances, supplying TMDB and provider credentials, configuring scoring, and binding Kometa configuration to an eligible Plex instance

#### Scenario: Defaults schedules and backups documented

- **WHEN** a reader configures routine behavior
- **THEN** the page explains the effective default apply method, review-first schedule controls, backup destination and retention, and which safety defaults never auto-apply artwork

#### Scenario: Env vars and Settings UI reconciled

- **WHEN** a reader configures the app
- **THEN** the page lists the supported environment variables and explains how they relate to the in-app Settings page, including source precedence, secret handling, scope, and restart requirements

### Requirement: Usage documentation

The documentation site SHALL include a usage page that walks through synchronizing a library, following jobs to terminal status, reviewing the actionable inbox, correcting a TMDB match, comparing and staging poster/background candidates, previewing and confirming an application through a supported media-server API and through Kometa, verifying results, and undoing from immutable revisions. It SHALL also cover custom sets, scalable library filters and sorting, saved review views, select-page/select-all-result behavior, failed-job details and retry, and full rescan.

#### Scenario: Core review and apply workflow documented

- **WHEN** a reader opens the usage page
- **THEN** it walks through sync, inbox review, candidate comparison, staging, exact preview, explicit confirmation, verified apply through Plex/Jellyfin/Emby and Kometa where supported, and apply-and-next

#### Scenario: Matching and recovery documented

- **WHEN** a title is unresolved, a provider or job fails, or applied artwork must be undone
- **THEN** the page explains manual TMDB matching, last-known-good candidates, job diagnostics and retry, and per-target revision-based undo

#### Scenario: Custom sets and library controls documented

- **WHEN** a reader wants to stage a custom poster/background pair or work across many results
- **THEN** the page explains custom sets, server-side filters and counts, sorting, saved views, page versus all-result selection, bulk preview, and full rescan

### Requirement: Contributing documentation

The documentation site SHALL include a contributing page that documents local development setup, the requirement to keep all five message catalogs at parity, the `$env`-free pure-test convention, and the project's quality gates (`bun run check`, `bun run test`, `bun run build`, and `bun run lint`) that must pass before a change is submitted.

#### Scenario: Dev setup documented

- **WHEN** a prospective contributor opens the contributing page
- **THEN** it explains how to set up the application and documentation site locally for development

#### Scenario: Quality gates documented

- **WHEN** a contributor prepares a change
- **THEN** the page states that `bun run check`, `bun run test`, `bun run build`, and `bun run lint` must pass before submitting

#### Scenario: Localization and test conventions documented

- **WHEN** a contributor changes user-facing copy or adds testable server logic
- **THEN** the page explains five-catalog parity and how to extract pure functions so unit tests do not depend on `$env`

## ADDED Requirements

### Requirement: Behavioral safety reference

The documentation site SHALL provide a concise reference for mutating contracts: exact preview before confirmation, confirmation bound to unchanged content, immutable original snapshots, per-target revision history, post-write verification, partial-success reporting, and revision-based undo. It SHALL separately document structured and raw Kometa preview/confirmation and explain that no default workflow auto-applies suggested artwork.

#### Scenario: Reader checks apply guarantees

- **WHEN** a reader consults the safety reference before applying artwork
- **THEN** it explains what is captured, previewed, confirmed, written, verified, recorded, and available for undo for media-server and Kometa targets

#### Scenario: Reader checks Kometa writes

- **WHEN** a reader consults the Kometa section
- **THEN** it explains preview tokens for structured sync and raw edits, secret redaction, atomic writes, backups, stale-preview rejection, and restoration

#### Scenario: Partial failure is investigated

- **WHEN** a bulk or collection operation has mixed outcomes
- **THEN** the reference explains per-slot result states, safe retry boundaries, and how successful and failed revisions remain auditable

### Requirement: Automation operations and recovery guide

The documentation site SHALL include an operations guide for durable jobs, review-first scheduled and event-driven discovery, duplicate prevention, retry/backoff, provider and path diagnostics, redacted support bundles, application backup creation/retention/export, restore preflight, encryption-key modes, rollback, and post-restore readiness. Examples SHALL make clear that schedules populate review work by default and that enabling any auto-apply policy is a separate explicit choice if supported.

#### Scenario: Administrator enables a schedule

- **WHEN** an administrator follows the automation guide
- **THEN** the guide explains triggers, server scope, durable attempts, deduplication, retry/backoff, review-inbox output, and the no-auto-apply default

#### Scenario: Administrator diagnoses a failure

- **WHEN** a server, provider, filesystem path, or job fails
- **THEN** the guide explains health fields, last success/error, retry, writable-path tests, and creation of a redacted support bundle

#### Scenario: Administrator backs up and restores

- **WHEN** an administrator follows the recovery guide
- **THEN** it explains consistent backup contents, the difference between auto-generated key and `APP_SECRET` modes, secret-bearing export handling, validation preview, safety backup, rollback, and readiness checks

### Requirement: Fun and collection workflow guides

The documentation site SHALL document the opt-in Fun hub and media-collection workflows. The Fun guide SHALL cover the three-choice picker and its filters, stable shareable results, repeat avoidance, poster match, ambient gallery and reduced motion, blind/capsule picks, and duration-budget sessions. The collection guide SHALL cover discovery provenance, consistency indicators, coordinated family coverage, per-member overrides, exact bulk preview, partial results, and group or individual undo.

#### Scenario: Reader uses the expanded picker

- **WHEN** a reader wants a night selection
- **THEN** the Fun guide explains eligibility counts, validation, presets, three distinct choices, stable sharing, unavailable shared items, and recent-repeat behavior

#### Scenario: Reader uses another Fun experiment

- **WHEN** a reader chooses poster match, ambient gallery, blind/capsule picks, or a session plan
- **THEN** the guide explains eligibility, controls, accessibility behavior, and that artwork winners are staged rather than automatically applied

#### Scenario: Reader coordinates a collection

- **WHEN** a reader opens a franchise or native collection
- **THEN** the collection guide explains source-scoped membership, visual-family evidence, coverage gaps, overrides, preview/confirmation, verified results, and undo

### Requirement: Multi-server administration and migration guide

The documentation site SHALL document adding, testing, naming, switching, disabling, disconnecting, and purging multiple server instances; strict data and job scoping; instance-specific capabilities; Plex-specific Kometa binding; and explicit identifier-based cross-server application. It SHALL include an upgrade guide explaining the idempotent in-place migration from an existing single-server installation, pre-upgrade backup guidance, expected post-migration state, validation steps, and recovery steps if migration cannot complete.

#### Scenario: Existing installation upgrades

- **WHEN** a single-server administrator follows the multi-server upgrade guide
- **THEN** it instructs them to take a backup, explains creation of the default named instance and preservation of cached data, and provides checks for libraries, items, jobs, revisions, and credentials after migration

#### Scenario: Administrator adds another server

- **WHEN** a reader follows the multi-server administration guide
- **THEN** it explains authentication, connection testing, server switching, scope labels, independent schedules and jobs, and provider-specific capability differences

#### Scenario: Administrator uses cross-server apply

- **WHEN** a reader wants to reuse artwork on another server
- **THEN** the guide explains exact external-identifier matching, destination selection, per-server preview and revisions, partial failures, and why title-only or implicit propagation is prohibited

#### Scenario: Administrator removes a server

- **WHEN** a reader needs to stop managing an instance
- **THEN** the guide distinguishes disable, disconnect, and permanent purge, including credential removal, retained history, active-job blocking, destructive confirmation, and backup guidance

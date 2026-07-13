## MODIFIED Requirements

### Requirement: Externalized message catalogs

The system SHALL store all user-facing UI strings in per-locale message catalogs (one JSON file per locale: `messages/en.json`, `messages/es.json`, `messages/zh.json`, `messages/ja.json`, `messages/pt-BR.json`), keyed by a stable message id, rather than hardcoded in components. The English catalog SHALL be the complete source catalog containing every message id, and every other supported catalog SHALL contain the same key set before a change can pass validation. This SHALL cover labels, buttons, headings, hints, validation messages, empty states, confirmations, job states, errors, accessibility labels, and result summaries for setup, review, apply and undo, Kometa, diagnostics, Fun experiments, automation, backups, collections, and multi-server management. The UI SHALL reference messages only through the generated type-safe message functions, never by interpolating a raw catalog string at the call site.

#### Scenario: Source catalog is complete

- **WHEN** the application is built
- **THEN** every UI string the user can see corresponds to a message id present in the English source catalog

#### Scenario: Supported catalogs remain at parity

- **WHEN** catalog validation runs for a change that adds, removes, or renames a message id
- **THEN** it fails unless English, Spanish, Simplified Chinese, Japanese, and Brazilian Portuguese contain exactly the same message-id set

#### Scenario: New workflows are localized

- **WHEN** the user opens review, revisions, diagnostics, an expanded Fun tool, automation, backup/restore, collections, or multi-server management in any supported locale
- **THEN** all visible workflow copy, state labels, errors, confirmations, summaries, and accessibility labels render through that locale's catalog

#### Scenario: Messages referenced by id

- **WHEN** a component needs to display a label, button, heading, banner, or status text
- **THEN** it calls the message function for that id and the active locale's text is rendered

#### Scenario: Parameterized messages

- **WHEN** a message contains a runtime value (e.g. a count, server name, job state, or item title)
- **THEN** the message is defined with named parameters in the catalog and rendered by passing those parameters to the message function, not by string concatenation in the component

## ADDED Requirements

### Requirement: Server-neutral and provider-aware terminology

Shared setup, library, review, artwork, job, diagnostics, and settings paths SHALL use media-server-neutral message ids and copy. When provider-specific terminology is required, the system SHALL select a localized Plex-, Jellyfin-, or Emby-specific message from the concrete server instance instead of hardcoding Plex wording or deriving a sentence by concatenation. Product and protocol names SHALL remain unchanged unless the project's terminology catalog explicitly supplies a localized display name.

#### Scenario: Jellyfin or Emby is active

- **WHEN** a shared workflow renders for a Jellyfin or Emby instance
- **THEN** it uses neutral media-server wording or that provider's localized terminology and does not instruct the user to perform a Plex-specific action

#### Scenario: Plex-only feature is shown

- **WHEN** a capability such as Plex PIN login or a Plex-bound Kometa connection is rendered
- **THEN** the UI uses an explicitly Plex-specific localized message and identifies why the capability applies to that named server

#### Scenario: Server name appears in a sentence

- **WHEN** localized copy includes a user-defined server name or provider name
- **THEN** the complete sentence comes from a parameterized message function rather than joining translated fragments at the call site

### Requirement: Locale-neutral persisted and API states

The system SHALL persist and transmit durable job states, error categories, activity types, backup results, provider outcomes, revision actions, and automation states as locale-neutral codes with structured parameters. User-facing routes SHALL translate those codes at render time in the active locale. Previously persisted events SHALL therefore render in the user's current locale, and server logs and API contracts SHALL NOT use translated prose as machine-readable control values.

#### Scenario: Locale changes after a job completes

- **WHEN** a job completes in one locale and the user later views it after selecting another supported locale
- **THEN** the same stored state code and parameters render as user-facing text in the newly active locale

#### Scenario: Structured API error is rendered

- **WHEN** an API returns a known error code with named parameters
- **THEN** the client renders the matching localized message and does not expose the raw code as the primary user-facing explanation

#### Scenario: Unknown error code is received

- **WHEN** the UI receives an unrecognized locale-neutral error code
- **THEN** it renders a localized generic error, preserves a safe correlation identifier for diagnostics, and does not display secret-bearing raw details

#### Scenario: Machine-readable status is consumed

- **WHEN** a client or worker evaluates a job, revision, provider, backup, or schedule state
- **THEN** it branches on the stable locale-neutral code rather than comparing translated text

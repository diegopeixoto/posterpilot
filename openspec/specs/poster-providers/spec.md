# poster-providers Specification

## Purpose
Define the shared artwork-provider contract, built-in sources, enablement controls, and resilient multi-provider discovery behavior.
## Requirements
### Requirement: Poster provider abstraction

The system SHALL define a single provider interface for artwork sources that, given a resolved title (TMDB id and media type), returns artwork candidate sets. Each supported source — MediUX, Fanart.tv, TMDB artwork, and ThePosterDB — SHALL be implemented as a provider behind this interface, registered in a provider registry.

#### Scenario: Provider returns candidate sets

- **WHEN** discovery runs a provider for a resolved title
- **THEN** the provider returns zero or more candidate sets of artwork (posters, backgrounds, and where applicable season/title-card art) with absolute asset URLs

#### Scenario: New source added behind the interface

- **WHEN** a new artwork source is introduced
- **THEN** it is added as a provider implementing the interface and registered, without changing the discovery, candidate, or apply pipeline

### Requirement: Multi-provider discovery

The system SHALL discover candidates for a title by fanning out across all enabled providers and merging their results into the item's candidate list, tagging each candidate with the provider it came from.

#### Scenario: Candidates merged across providers

- **WHEN** more than one provider is enabled and discovery runs for a title
- **THEN** the system queries each enabled provider and stores the union of their candidate sets, each candidate tagged with its provider

#### Scenario: Provider tag persisted

- **WHEN** a candidate is stored
- **THEN** its originating provider is recorded so the UI can group and label it

### Requirement: Per-provider enablement

The system SHALL let the user enable or disable each provider, and SHALL only query enabled providers during discovery. Providers requiring credentials (Fanart.tv) SHALL be treated as unavailable when their credential is absent.

#### Scenario: Disabled provider skipped

- **WHEN** a provider is disabled
- **THEN** discovery does not query it and returns candidates only from the enabled providers

#### Scenario: Keyed provider without a key

- **WHEN** a provider that requires an API key is enabled but no key is configured
- **THEN** the system skips that provider and surfaces the missing-credential condition rather than failing discovery

### Requirement: Resilient discovery

The system SHALL isolate provider failures so that an error, timeout, or unparseable response from one provider does not prevent the others from returning candidates.

#### Scenario: One provider fails

- **WHEN** one enabled provider errors or returns an unparseable response during discovery
- **THEN** the system records that provider's failure, skips it, and still stores the candidates from the providers that succeeded

### Requirement: Built-in providers

The system SHALL ship providers for MediUX (scrape), ThePosterDB (scrape), Fanart.tv (keyed API), and TMDB artwork (using the existing TMDB credential), each producing poster and background candidates with absolute URLs.

#### Scenario: Fanart.tv candidates

- **WHEN** the Fanart.tv provider runs for a resolved title with a configured key
- **THEN** it returns the title's posters, backgrounds, and logos from the Fanart.tv API as candidates

#### Scenario: TMDB artwork candidates

- **WHEN** the TMDB-artwork provider runs for a resolved title
- **THEN** it returns posters and backdrops from the TMDB images endpoint as candidates, reusing the configured TMDB credential

#### Scenario: ThePosterDB candidates

- **WHEN** the ThePosterDB provider runs for a resolved title
- **THEN** it returns the title's community poster/background sets parsed from ThePosterDB, throttled and cached like the MediUX scraper

### Requirement: Optional ThePosterDB authenticated session

The ThePosterDB provider SHALL support optional account credentials (username +
password). When configured, discovery SHALL authenticate via the site's login form
(CSRF token scraped from the form), cache the session in memory with a TTL below the
observed cookie lifetime, deduplicate concurrent logins, and retry once with a fresh
session when a scrape returns empty. When credentials are absent, the provider SHALL
continue anonymous scraping exactly as today — credentials MUST NOT be required for
the provider to be available. A rejected login SHALL surface as a typed error and
never crash discovery of other providers.

#### Scenario: Authenticated discovery

- **WHEN** credentials are configured and discovery runs
- **THEN** requests carry the authenticated session and results include assets that anonymous access would serve as placeholders

#### Scenario: Anonymous fallback

- **WHEN** no credentials are configured
- **THEN** the provider stays available and scrapes anonymously as before

#### Scenario: Rejected credentials

- **WHEN** the site rejects the configured credentials
- **THEN** the provider reports a typed auth failure for its own results only, and other providers' discovery is unaffected

### Requirement: ThePosterDB candidates carry real set identity

ThePosterDB candidates parsed from a title page SHALL be keyed by the contributor's
real set id (`/set/<id>`) with the contributor's name as set author, deduplicating
the webp/jpg pair of each image. Result selection SHALL keep the strict title/year
matching semantics already specified (wrong year → no result rather than a wrong
film). When set markup cannot be parsed, the provider SHALL fall back to the flat
scrape rather than returning nothing.

#### Scenario: Set identity preserved

- **WHEN** a title page lists posters from two contributors
- **THEN** candidates carry two distinct real set ids with their authors, one candidate per image

#### Scenario: Markup drift falls back

- **WHEN** the contributor-card markup fails to parse
- **THEN** the provider falls back to the flat asset scrape

### Requirement: ThePosterDB collection sets map onto members

For a native collection, the system SHALL be able to discover ThePosterDB collection
sets by collection name, open a bounded number of contributor sets (best member
coverage wins), match set posters to collection members via tiered matching (exact
normalized title with year disambiguation, then token-subset, then equal-year), and
inject matched posters as ordinary per-member candidates keyed by the real set id so
the existing set-family engine can surface one coordinated design. Failures SHALL be
logged and produce empty results without affecting other providers' candidates.

#### Scenario: Coordinated collection design

- **WHEN** a ThePosterDB collection set covers most members of a native collection
- **THEN** each covered member gains a candidate from that set and the set family is offered across the collection

#### Scenario: No matching set

- **WHEN** no collection set matches the members
- **THEN** the collection's existing TMDB candidates are unaffected and no wrong-title artwork is injected

### Requirement: Concurrent discovery writes never fail on contention

Provider discovery SHALL be able to run concurrently for several providers without
database writes failing on `SQLITE_BUSY`: the database runs in WAL mode (file-backed
databases only) and discovery/event writes are serialized through an in-process
write queue.

#### Scenario: Parallel discovery is contention-safe

- **WHEN** multiple providers write discovery results concurrently
- **THEN** all writes land and no request fails with a database-locked error

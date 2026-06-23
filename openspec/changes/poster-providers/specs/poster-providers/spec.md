## ADDED Requirements

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

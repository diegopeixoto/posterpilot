## ADDED Requirements

### Requirement: Preserve TMDB artwork language provenance

The system SHALL retain the language provenance reported by TMDB for every discovered artwork candidate as either a normalized ISO 639-1 language code, an explicit untagged value, or an unknown legacy value. Language provenance SHALL remain available after persistence so filtering and automatic selection do not require another TMDB request.

#### Scenario: Tagged TMDB artwork discovered

- **WHEN** TMDB returns an image tagged with a language
- **THEN** the stored candidate retains the normalized base language code alongside its provider metadata

#### Scenario: Untagged TMDB artwork discovered

- **WHEN** TMDB explicitly returns an image without a language tag
- **THEN** the candidate is retained as explicitly untagged and can be treated as language-neutral

#### Scenario: Legacy candidate has no provenance

- **WHEN** a previously stored TMDB candidate does not distinguish unknown provenance from an explicitly untagged image
- **THEN** the system does not assume it is language-neutral and requires refreshed discovery before applying a restricted language policy

### Requirement: Preserve provider candidates for progressive disclosure

The system SHALL retain valid, deduplicated provider candidates independently of the number initially rendered by the UI. Ingestion SHALL preserve all results up to a documented defensive limit per provider and artwork kind, SHALL NOT apply the UI's initial batch size as a source limit, and SHALL expose independent inventory information for each artwork kind.

#### Scenario: TMDB returns more than the initial display batch

- **WHEN** TMDB returns more valid candidates of a kind than the UI initially displays
- **THEN** undisplayed candidates remain available for subsequent disclosure without another provider request

#### Scenario: Poster and backdrop inventories are independent

- **WHEN** an item has additional posters but no additional backdrops, or vice versa
- **THEN** availability and remaining counts are reported independently for each artwork kind

#### Scenario: Protective source limit is reached

- **WHEN** the documented defensive limit prevents retaining every provider result
- **THEN** the provider outcome is marked truncated rather than presenting the retained count as the complete inventory

### Requirement: Canonical provider result ordering

The system SHALL order productive provider groups using the configured canonical provider order after parallel discovery completes. Ordering SHALL NOT depend on response latency, transaction completion, candidate insertion identifiers, or first-seen candidate order. The configured order SHALL affect only presentation and deterministic provider tie-breaking after ordinary candidate scores are equal.

#### Scenario: Providers finish out of order

- **WHEN** a lower-priority provider completes before a higher-priority provider
- **THEN** the merged result still places the higher-priority productive provider first

#### Scenario: Provider has no candidates

- **WHEN** a configured provider returns no candidates
- **THEN** it is omitted from candidate groups without changing the relative order of productive providers

#### Scenario: Unknown provider is present

- **WHEN** stored candidates reference a provider not present in the configured order
- **THEN** unknown providers are placed after known providers with stable ordering

#### Scenario: Candidate scores differ

- **WHEN** candidates from differently ordered providers have unequal computed scores
- **THEN** the higher-scoring eligible candidate remains preferred regardless of provider display order

## MODIFIED Requirements

### Requirement: Poster provider abstraction

The system SHALL define a single provider interface for artwork sources that, given a resolved title and media type, returns artwork candidate sets. Each candidate SHALL carry its provider, stable provider asset identity when available, artwork kind, canonical destination URL, optimized preview URL when available, dimensions, and language provenance. Each supported source—MediUX, Fanart.tv, TMDB artwork, and ThePosterDB—SHALL be implemented behind this interface and registered in the provider registry.

#### Scenario: Provider returns candidate sets

- **WHEN** discovery runs a provider for a resolved title
- **THEN** the provider returns zero or more candidate sets with absolute canonical asset URLs and the metadata available for safe display and application

#### Scenario: Provider supplies an optimized preview

- **WHEN** a provider offers a smaller representation of the same canonical asset
- **THEN** the candidate exposes that URL separately without replacing its canonical destination URL

#### Scenario: New source added behind the interface

- **WHEN** a new artwork source is introduced
- **THEN** it is added as a provider implementing the interface and registered without changing the discovery, candidate, or apply pipeline

### Requirement: Built-in providers

The system SHALL ship providers for MediUX, ThePosterDB, Fanart.tv, and TMDB artwork. Each provider SHALL produce canonical poster and background candidates with optimized previews where available, and TMDB SHALL additionally retain the provider file identity and image-language provenance returned by its images endpoint.

#### Scenario: Fanart.tv candidates

- **WHEN** the Fanart.tv provider runs for a resolved title with a configured key
- **THEN** it returns the title's posters, backgrounds, and logos from the Fanart.tv API as candidates

#### Scenario: TMDB artwork candidates

- **WHEN** the TMDB-artwork provider runs for a resolved title
- **THEN** it returns posters and backdrops from the TMDB images endpoint with canonical original assets, optimized previews, file identity, dimensions, and language provenance, reusing the configured TMDB credential

#### Scenario: ThePosterDB candidates

- **WHEN** the ThePosterDB provider runs for a resolved title
- **THEN** it returns the title's community poster and background sets parsed from ThePosterDB, throttled and cached like the MediUX scraper

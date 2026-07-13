# mediux-scraping Specification

## Purpose

Define MediaUX set discovery, candidate extraction, request resilience, caching, and provider integration.
## Requirements
### Requirement: Discover MediaUX sets for a TMDB ID

The system SHALL fetch the MediaUX page for a TMDB ID (using the movie or show path based on media type) and extract the list of artwork set links, ordered newest-first.

#### Scenario: Sets found

- **WHEN** the system requests covers for a resolved TMDB ID
- **THEN** it fetches the corresponding mediux.pro page, extracts the set links, and returns them ordered newest-first

#### Scenario: No sets available

- **WHEN** the MediaUX page contains no sets for the TMDB ID
- **THEN** the system returns an empty candidate list and marks the item as having no MediaUX artwork

### Requirement: Extract poster candidates from a set

The system SHALL extract each set's artwork from the embedded page data, producing candidate entries that include the asset URL, the kind (poster, background, season poster, or episode title card) with season/episode numbers where applicable, the owning set identifier, and the set's uploader attribution (author) when present in the payload. Candidates SHALL remain grouped by set so the UI can present each set as a unit.

#### Scenario: Candidates extracted

- **WHEN** a set page is loaded
- **THEN** the system parses the embedded JSON payload and returns poster and background candidates with absolute asset URLs, their kind, and the set they belong to

#### Scenario: Set attribution captured

- **WHEN** the embedded payload includes the uploader/author for a set
- **THEN** the system records that author on the set's candidates so the item page can show who made the set

#### Scenario: Attribution missing

- **WHEN** the embedded payload has no identifiable author for a set
- **THEN** the system records the set's candidates with no author and continues without failing

#### Scenario: Page structure changed

- **WHEN** the embedded payload cannot be parsed in the expected shape
- **THEN** the system records a parse failure for that set, skips it, and continues with the remaining sets rather than aborting the whole item

### Requirement: Throttle, retry, and cache MediaUX requests

The system SHALL rate-limit outbound MediaUX requests with a configurable delay and concurrency cap, retry transient failures with backoff, and cache fetched responses to avoid redundant network calls.

#### Scenario: Rate limiting and concurrency

- **WHEN** the system scrapes many items concurrently
- **THEN** it bounds concurrency to the configured cap and applies the configured per-request delay so the source is not overloaded

#### Scenario: Transient failure retried

- **WHEN** a MediaUX request fails with a transient error (timeout or 5xx)
- **THEN** the system retries with backoff up to the configured maximum before recording the item as failed

#### Scenario: Cached response reused

- **WHEN** a MediaUX URL was fetched within the cache window and no forced refresh is requested
- **THEN** the system serves the cached response instead of making a network request

### Requirement: MediUX as a poster provider

The MediUX scraper and parser SHALL be exposed through the shared `PosterProvider` interface as the MediUX provider, so MediUX discovery participates in multi-provider fan-out rather than being the sole, hard-wired candidate source.

#### Scenario: MediUX invoked as a provider

- **WHEN** discovery fans out across enabled providers and MediUX is enabled
- **THEN** the MediUX provider is invoked through the shared interface and returns its candidate sets tagged with the `mediux` provider

#### Scenario: MediUX behaviour preserved

- **WHEN** the MediUX provider runs
- **THEN** it retains its existing listing-payload parsing, target-title filtering, throttling, retry, and caching behaviour

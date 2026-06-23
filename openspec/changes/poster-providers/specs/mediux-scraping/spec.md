## ADDED Requirements

### Requirement: MediUX as a poster provider

The MediUX scraper and parser SHALL be exposed through the shared `PosterProvider` interface as the MediUX provider, so MediUX discovery participates in multi-provider fan-out rather than being the sole, hard-wired candidate source.

#### Scenario: MediUX invoked as a provider

- **WHEN** discovery fans out across enabled providers and MediUX is enabled
- **THEN** the MediUX provider is invoked through the shared interface and returns its candidate sets tagged with the `mediux` provider

#### Scenario: MediUX behaviour preserved

- **WHEN** the MediUX provider runs
- **THEN** it retains its existing listing-payload parsing, target-title filtering, throttling, retry, and caching behaviour

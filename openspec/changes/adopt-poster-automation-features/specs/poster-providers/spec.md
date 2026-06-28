## ADDED Requirements

### Requirement: Candidate scoring metadata

Discovered poster candidates SHALL carry the metadata needed to score them — at minimum image
width, height, and a computed score combining provider weight, resolution, and aspect-ratio fit —
so selection can rank candidates across providers.

#### Scenario: Dimensions and score recorded on discovery

- **WHEN** the system discovers candidates for an item
- **THEN** each candidate records its image dimensions (where available) and a computed score

#### Scenario: Score reflects configured weights

- **WHEN** scoring weights change in configuration and discovery (or re-scoring) runs
- **THEN** candidate scores reflect the updated weights

### Requirement: Binary thumbnail cache for provider previews

The system SHALL cache provider preview images as binary data, bounded by TTL and total size with
least-recently-used eviction, and SHALL serve cached bytes for repeat views to reduce provider
bandwidth and latency.

#### Scenario: Cache miss fetches and stores

- **WHEN** a provider preview image is requested and not present in the thumbnail cache
- **THEN** the system fetches it from the provider, stores the bytes, and serves them

#### Scenario: Cache hit served locally

- **WHEN** a previously cached provider preview image is requested again within its TTL
- **THEN** the system serves the cached bytes without re-fetching from the provider

#### Scenario: Bounded by size with eviction

- **WHEN** the thumbnail cache exceeds its configured size bound
- **THEN** the least-recently-used entries are evicted to stay within the bound

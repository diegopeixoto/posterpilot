## ADDED Requirements

### Requirement: Single Plex implementation

The system SHALL have a single shared implementation of the Plex integration logic — request/auth
header construction, poster/image URL building, response parsing, and section/library listing — rather
than duplicated blocks, so a fix or protocol change is made in one place. The consolidation SHALL be
behavior-preserving: identical requests and parsed results.

#### Scenario: No duplicated Plex blocks

- **WHEN** the Plex integration is built after consolidation
- **THEN** each of the previously duplicated concerns has one implementation that all callers use

#### Scenario: Behavior preserved

- **WHEN** the consolidated path constructs a Plex request or parses a response
- **THEN** the result is identical to the pre-refactor behavior, and the existing Plex tests pass

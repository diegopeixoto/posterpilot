## MODIFIED Requirements

### Requirement: Apply a selected cover via one or both methods

The system SHALL apply a selected cover using the method(s) chosen by the user: direct upload to the active media server, Kometa YAML export, or both. The method SHALL be selectable per apply action with a configurable default. The direct method SHALL route through the active media-server provider (Plex, Jellyfin, or Emby), not Plex specifically.

#### Scenario: Direct apply only

- **WHEN** the user applies a selection with the direct method
- **THEN** the system uploads the poster through the active media-server provider, locks the field, and records the application as method "server" with the provider's type

#### Scenario: Kometa export only

- **WHEN** the user applies a selection with the Kometa method
- **THEN** the system writes or updates Kometa-compatible YAML for the item without contacting the media server, and records the application as method "kometa"

#### Scenario: Both methods

- **WHEN** the user applies a selection with both methods
- **THEN** the system performs the direct upload via the active provider and writes the Kometa YAML, and records both outcomes independently so a partial failure is visible

### Requirement: Apply a custom cover

The system SHALL let a user supply a custom cover for an item outside the discovered candidates, either by pasting an image URL or by uploading an image file. A URL-based custom cover SHALL be applicable via both the active media server and Kometa; an uploaded file SHALL be applicable via the active media server only, because a binary upload cannot be expressed as a Kometa YAML URL.

#### Scenario: Custom URL staged

- **WHEN** the user enters an image URL for the poster or background slot
- **THEN** the system stages that URL as the pending selection and allows applying it through the active media server and/or Kometa

#### Scenario: Uploaded file applied to the server

- **WHEN** the user uploads an image file for an item
- **THEN** the system uploads the bytes directly to the active media-server provider and records the application as method "server"

#### Scenario: Uploaded file not exportable to Kometa

- **WHEN** the user has staged an uploaded file (not a URL) and selects a method that includes Kometa
- **THEN** the system applies the upload to the active media server and omits it from Kometa export, making the limitation visible rather than writing an invalid YAML entry

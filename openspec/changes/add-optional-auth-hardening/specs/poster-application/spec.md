## MODIFIED Requirements

### Requirement: Apply a custom cover

The system SHALL let a user supply a custom cover for an item outside the discovered candidates, either by pasting an image URL or by uploading an image file. A URL-based custom cover SHALL be applicable via both the active media server and Kometa; an uploaded file SHALL be applicable via the active media server only, because a binary upload cannot be expressed as a Kometa YAML URL. An uploaded file SHALL be validated by its content (magic-byte sniffing to an allow-list of JPEG, PNG, and WebP) and rejected if it exceeds a configured size cap, before it is applied; the client-declared content type SHALL NOT be trusted.

#### Scenario: Custom URL staged

- **WHEN** the user enters an image URL for the poster or background slot
- **THEN** the system stages that URL as the pending selection and allows applying it through the active media server and/or Kometa

#### Scenario: Uploaded file applied to the server

- **WHEN** the user uploads a valid image file (JPEG, PNG, or WebP within the size cap) for an item
- **THEN** the system uploads the bytes directly to the active media-server provider and records the application as method "server"

#### Scenario: Uploaded file not exportable to Kometa

- **WHEN** the user has staged an uploaded file (not a URL) and selects a method that includes Kometa
- **THEN** the system applies the upload to the active media server and omits it from Kometa export, making the limitation visible rather than writing an invalid YAML entry

#### Scenario: Spoofed content type rejected

- **WHEN** the user uploads a file whose bytes are not a JPEG, PNG, or WebP (for example a text file renamed with an image extension)
- **THEN** the system rejects it with an unsupported-media-type error and does not apply it

#### Scenario: Oversized upload rejected

- **WHEN** the user uploads a file larger than the configured size cap
- **THEN** the system rejects it with a payload-too-large error and does not apply it

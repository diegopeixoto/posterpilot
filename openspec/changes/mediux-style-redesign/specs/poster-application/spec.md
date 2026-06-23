## MODIFIED Requirements

### Requirement: Select a candidate cover

The system SHALL let a user stage a pending selection for an item consisting of a poster and/or a background chosen from the discovered MediaUX candidates. The user SHALL be able to stage both pieces of one set at once ("use this set") or take an individual poster or background from any set. The system SHALL support an automatic selection that picks the newest set's primary poster.

#### Scenario: Manual selection

- **WHEN** the user picks a specific poster or background candidate for an item
- **THEN** the system records that candidate as the corresponding pending selection (poster or background) for the item

#### Scenario: Stage a whole set

- **WHEN** the user chooses "use this set" on a set that has both a poster and a backdrop
- **THEN** the system stages that set's poster and backdrop together as the item's pending selection

#### Scenario: Mix pieces across sets

- **WHEN** the user stages a poster from one set and a backdrop from a different set
- **THEN** the system keeps both as the item's pending selection independently of which set each came from

#### Scenario: Automatic selection

- **WHEN** the user requests automatic selection for an item or a bulk set of items
- **THEN** the system selects the primary poster from the newest available set for each item

## ADDED Requirements

### Requirement: Apply a custom cover

The system SHALL let a user supply a custom cover for an item outside the discovered candidates, either by pasting an image URL or by uploading an image file. A URL-based custom cover SHALL be applicable via both Plex and Kometa; an uploaded file SHALL be applicable via Plex only, because a binary upload cannot be expressed as a Kometa YAML URL.

#### Scenario: Custom URL staged

- **WHEN** the user enters an image URL for the poster or background slot
- **THEN** the system stages that URL as the pending selection and allows applying it through Plex and/or Kometa

#### Scenario: Uploaded file applied to Plex

- **WHEN** the user uploads an image file for an item
- **THEN** the system uploads it directly to Plex and records the application as method "plex"

#### Scenario: Uploaded file not exportable to Kometa

- **WHEN** the user has staged an uploaded file (not a URL) and selects a method that includes Kometa
- **THEN** the system applies the upload to Plex and omits it from Kometa export, making the limitation visible rather than writing an invalid YAML entry

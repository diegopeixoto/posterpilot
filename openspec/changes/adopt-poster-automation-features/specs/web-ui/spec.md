## ADDED Requirements

### Requirement: Emby/Jellyfin login form

The Settings view SHALL offer Emby and Jellyfin a username/password login (mirroring the Plex login
layout) that authenticates and stores the resulting token, with manual API-key entry available as an
advanced fallback.

#### Scenario: Log in from Settings

- **WHEN** the user selects Emby or Jellyfin and submits the login form with valid credentials
- **THEN** the UI shows the connection as authenticated and does not require pasting an API key

#### Scenario: Manual key still reachable

- **WHEN** the user expands the advanced option
- **THEN** a manual API-key field is available as a fallback

### Requirement: Ignore toggle and filter in the library

The library view SHALL let the user mark an item ignored, visually distinguish ignored items, and
filter the grid by ignored state.

#### Scenario: Mark an item ignored

- **WHEN** the user toggles ignore on an item
- **THEN** the item is marked ignored and visually distinguished in the grid

#### Scenario: Filter by ignored state

- **WHEN** the user applies the ignored filter
- **THEN** the grid shows (or hides) ignored items accordingly

### Requirement: Dry-run preview before bulk apply

The bulk apply flow SHALL present a dry-run preview of planned changes before the user confirms.

#### Scenario: Preview shown before applying

- **WHEN** the user initiates a bulk apply
- **THEN** the UI shows a preview summarizing planned uploads, exports, and skipped items, and applies only after explicit confirmation

### Requirement: Suggested poster shown as overridable pre-selection

The item detail view SHALL pre-select the highest-scored candidate per slot as a clearly marked,
overridable suggestion when suggested pre-selection is enabled.

#### Scenario: Suggestion is marked and overridable

- **WHEN** the item view loads candidates that have scores and pre-selection is enabled
- **THEN** the top-scored candidate per slot is pre-selected and labeled as suggested, and the user can choose a different candidate

#### Scenario: Pre-selection disabled

- **WHEN** suggested pre-selection is disabled in Settings
- **THEN** no candidate is pre-selected by default

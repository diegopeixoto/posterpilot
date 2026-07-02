# fun-random-picker Specification

## Purpose

TBD - created by syncing change add-fun-menu. Update Purpose after sync.
## Requirements
### Requirement: Fun section gated by setting

The system SHALL provide a "Fun" navigation destination at `/fun` that is visible and reachable only when the `funEnabled` setting is on. When the setting is off (the default), the navigation entry SHALL NOT be rendered and direct requests to `/fun` SHALL return a 404. The section's UI text SHALL render in the active locale.

#### Scenario: Fun disabled by default

- **WHEN** a fresh installation is browsed without changing settings
- **THEN** no "Fun" entry appears in the navigation and requesting `/fun` directly returns a 404

#### Scenario: Fun enabled

- **WHEN** the user enables the Fun toggle in settings and saves
- **THEN** a "Fun" entry appears in the navigation and `/fun` renders the Fun section

#### Scenario: Localized Fun UI

- **WHEN** the active locale is not English
- **THEN** the Fun navigation label and all picker UI text render in the active locale (falling back to English for untranslated messages)

### Requirement: Random movie/series picker

The Fun section SHALL offer a random picker that selects one item uniformly at random from the synced library, filtered by the user's criteria: media type (movie, show, or both), a single genre drawn from the library's genre list (or all genres), an optional year range (minimum and/or maximum release year), and whether watched items are included (included by default). The picker SHALL present the selected item image-forward — poster (or placeholder when missing), title, year, type, genres, and rating/overview when available — with a link to the item's detail page and a re-roll control that draws a new random item under the same filters.

#### Scenario: Pick with default filters

- **WHEN** the user triggers a pick with no filters changed
- **THEN** the system returns one random item from the entire synced library (movies and shows, all genres, all years, watched included) and displays it with its poster and metadata

#### Scenario: Filters applied

- **WHEN** the user restricts the pick to a media type, a genre, and/or a year range
- **THEN** the returned item satisfies every active filter

#### Scenario: Watched items excluded

- **WHEN** the user sets the picker to exclude watched items
- **THEN** the returned item is one whose synced watched flag is false (items never synced with watched data count as unwatched)

#### Scenario: Re-roll

- **WHEN** the user triggers the re-roll control
- **THEN** the system draws another random item under the same active filters

#### Scenario: No item matches

- **WHEN** no synced item satisfies the active filters
- **THEN** the system shows a localized empty state explaining no match was found, without an error

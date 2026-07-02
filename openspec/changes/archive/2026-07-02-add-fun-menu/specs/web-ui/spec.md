# web-ui Specification (delta)

## MODIFIED Requirements

### Requirement: Library grid with filters and search

The system SHALL present the synced library as a poster grid that can be searched by title and filtered by media type (movie/show), poster state (missing poster), MediaUX availability (has candidates), change state (unchanged / still on the Plex default), minimum rating, and genre. The grid SHALL be sortable by title, release year, rating, runtime, most-recently-changed, and date added to the server (newest first by default; items without date-added data ordered last). When no sort is specified in the URL, the grid SHALL open with the sort named by the `libraryDefaultSort` setting. The grid SHALL show a spotlight backdrop banner for a recently-changed item above the wall, and each tile SHALL surface the item's rating and a status badge (e.g. MediUX-available, changed) with the title and year revealed on hover. All of the grid's own UI text — filter and sort labels, control placeholders, status badges, and the empty state — SHALL render in the active locale.

#### Scenario: Filter and search applied

- **WHEN** the user selects filters and/or types a search query
- **THEN** the grid updates to show only items matching the active filters and query, with each item's current poster

#### Scenario: Sort applied

- **WHEN** the user selects a sort option (title, year, rating, runtime, recently changed, or date added)
- **THEN** the grid reorders the visible items accordingly

#### Scenario: Date-added sort

- **WHEN** the user sorts by date added
- **THEN** items order newest-first by their server date-added, with items lacking the data placed last

#### Scenario: Configured default sort

- **WHEN** the library is opened without a sort URL parameter
- **THEN** the grid uses the sort named by the `libraryDefaultSort` setting (falling back to title)

#### Scenario: Rating and genre filtering

- **WHEN** the user sets a minimum rating and/or selects one or more genres
- **THEN** the grid shows only items meeting the rating threshold and matching the selected genres

#### Scenario: Spotlight banner

- **WHEN** at least one item has had a cover applied
- **THEN** the library shows a spotlight backdrop banner for a recently-changed item above the poster wall

#### Scenario: Empty library

- **WHEN** no library has been synced yet
- **THEN** the grid shows an empty state prompting the user to configure Plex and run a sync

#### Scenario: Localized controls and badges

- **WHEN** the active locale is not English
- **THEN** the filter/sort labels, control placeholders, status badges, and empty-state text are rendered in the active locale (falling back to English for any untranslated message)

## ADDED Requirements

### Requirement: Fun navigation entry and settings toggle

The web UI SHALL show a "Fun" entry in the main navigation only when the `funEnabled` setting is on, and SHALL offer a Fun toggle in the settings view (advanced section) using the same checkbox pattern as other boolean settings, including the environment-managed disabled state. The settings view SHALL also offer a default-library-sort select listing the grid's sort options. The navigation label and settings labels SHALL render in the active locale.

#### Scenario: Nav entry hidden when disabled

- **WHEN** `funEnabled` is off
- **THEN** the main navigation renders without a "Fun" entry

#### Scenario: Nav entry shown when enabled

- **WHEN** `funEnabled` is on
- **THEN** the main navigation includes a "Fun" entry linking to `/fun`, with active-state styling consistent with the other entries

#### Scenario: Toggle environment-managed

- **WHEN** `FUN_ENABLED` is set in the environment
- **THEN** the settings toggle reflects that value and is disabled, indicating it is environment-managed

#### Scenario: Default sort selected in settings

- **WHEN** the user picks a default library sort in settings and saves
- **THEN** the system persists it as the `libraryDefaultSort` setting and the library grid opens with that sort on subsequent visits without a sort URL parameter

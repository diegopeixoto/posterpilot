## MODIFIED Requirements

### Requirement: Library grid with filters and search

The system SHALL present the synced library as a poster grid that can be searched by title and filtered by media type (movie/show), poster state (missing poster), MediaUX availability (has candidates), change state (unchanged / still on the Plex default), minimum rating, and genre. The grid SHALL be sortable by title, release year, rating, runtime, most-recently-changed, and date added to the server (newest first by default; items without date-added data ordered last). When no sort is specified in the URL, the grid SHALL open with the sort named by the `libraryDefaultSort` setting. The grid SHALL show a spotlight backdrop banner for a recently-changed item above the wall, and each tile SHALL surface the item's rating and a status badge (e.g. MediUX-available, changed) with the title and year revealed on hover. All of the grid's own UI text — filter and sort labels, control placeholders, status badges, and the empty state — SHALL render in the active locale.

The grid SHALL load a bounded first page of items rather than the entire library, and SHALL load further items incrementally as the user scrolls (or via an explicit "load more" control), preserving the active filters and sort. Each tile's poster image SHALL be served from the cached poster-thumbnail endpoint (see the `library-thumbnails` capability), not the raw media-server URL, and SHALL declare its intrinsic dimensions and asynchronous decoding to reduce layout and rendering cost.

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

#### Scenario: Bounded first page

- **WHEN** the library page loads for a large library
- **THEN** only a bounded first page of items is rendered and serialized, not the entire library

#### Scenario: Incremental loading

- **WHEN** the user scrolls to the end of the loaded items (or activates a "load more" control) while more items match the active filters and sort
- **THEN** the next page of items is fetched and appended, preserving the current filters and sort, until the library is exhausted

#### Scenario: Posters served from the thumbnail cache

- **WHEN** a grid tile renders its poster
- **THEN** the image is requested from the cached poster-thumbnail endpoint (by item id) rather than the raw media-server URL, and carries intrinsic dimensions and asynchronous decoding

#### Scenario: Localized controls and badges

- **WHEN** the active locale is not English
- **THEN** the filter/sort labels, control placeholders, status badges, and empty-state text are rendered in the active locale (falling back to English for any untranslated message)

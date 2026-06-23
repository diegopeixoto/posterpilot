## MODIFIED Requirements

### Requirement: Library grid with filters and search

The system SHALL present the synced library as a poster grid that can be searched by title and filtered by media type (movie/show), poster state (missing poster), MediaUX availability (has candidates), change state (unchanged / still on the Plex default), minimum rating, and genre. The grid SHALL be sortable by title, release year, rating, runtime, and most-recently-changed. The grid SHALL show a spotlight backdrop banner for a recently-changed item above the wall, and each tile SHALL surface the item's rating and a status badge (e.g. MediUX-available, changed) with the title and year revealed on hover.

#### Scenario: Filter and search applied

- **WHEN** the user selects filters and/or types a search query
- **THEN** the grid updates to show only items matching the active filters and query, with each item's current poster

#### Scenario: Sort applied

- **WHEN** the user selects a sort option (title, year, rating, runtime, or recently changed)
- **THEN** the grid reorders the visible items accordingly

#### Scenario: Rating and genre filtering

- **WHEN** the user sets a minimum rating and/or selects one or more genres
- **THEN** the grid shows only items meeting the rating threshold and matching the selected genres

#### Scenario: Spotlight banner

- **WHEN** at least one item has had a cover applied
- **THEN** the library shows a spotlight backdrop banner for a recently-changed item above the poster wall

#### Scenario: Empty library

- **WHEN** no library has been synced yet
- **THEN** the grid shows an empty state prompting the user to configure Plex and run a sync

### Requirement: Item detail with candidate comparison

The system SHALL provide an item detail view led by a backdrop hero that displays the item's clearlogo (falling back to the title text when no logo exists), its rating, release year, and runtime for movies or season and episode counts for shows, its genres, and its overview, with the discover and apply actions available in the hero. Below the hero the system SHALL present the discovered MediaUX candidates grouped into sets, each set showing its uploader attribution with poster and backdrop together, and SHALL let the user stage a whole set or an individual piece, preview the current selection, and apply it via the chosen method(s). For shows the view SHALL additionally present season-poster sets and title-card sets.

#### Scenario: Hero with metadata

- **WHEN** the user opens an enriched item
- **THEN** the view shows the backdrop hero with the logo or title, rating, year, runtime or season/episode counts, genres, and overview, alongside the current poster

#### Scenario: Compare and select by set

- **WHEN** the user opens an item with discovered candidates
- **THEN** the candidates are displayed grouped into sets with attribution, and the user can stage a whole set or take an individual poster or background and trigger apply

#### Scenario: Show artwork

- **WHEN** the opened item is a show with discovered candidates
- **THEN** the view also presents the season-poster sets and title-card sets for that show

#### Scenario: No candidates yet

- **WHEN** the user opens an item whose covers have not been discovered
- **THEN** the view offers a "find covers" action that runs discovery for that item

## ADDED Requirements

### Requirement: Custom set builder

The system SHALL provide a persistent, sticky builder on the item detail view with a poster slot and a background slot that together form a custom "set". Selecting a candidate SHALL route it to the matching slot by kind. Each slot SHALL also be fillable from a pasted image URL or an uploaded image file. The builder SHALL apply both staged pieces in one action using the user's chosen method, respecting that uploaded files are Plex-only.

#### Scenario: Auto-route by kind

- **WHEN** the user clicks a poster candidate or a background candidate
- **THEN** the system places it in the poster slot or the background slot of the builder respectively

#### Scenario: Fill from URL or upload

- **WHEN** the user provides an image URL or uploads a file for a slot
- **THEN** the system stages that image in the slot, ready to apply

#### Scenario: Apply the staged set

- **WHEN** the user applies the builder with a poster and/or background staged
- **THEN** the system applies the staged poster and background together via the selected method and records the outcome

### Requirement: Unified MediUX visual language

The system SHALL render every page (Dashboard, Library, Item detail, Jobs, Settings) within a shared application shell using one consistent theme: a near-black background, a single accent color, a glassy sticky header with navigation, and consistent card styling.

#### Scenario: Consistent shell across pages

- **WHEN** the user navigates between any of the app's pages
- **THEN** each page renders within the same themed shell — shared header, accent color, and card styling

#### Scenario: Active navigation indicated

- **WHEN** the user is on a given page
- **THEN** the corresponding navigation item is visually marked as active

# web-ui Specification

## Purpose

TBD - created by archiving change add-poster-manager. Update Purpose after archive.
## Requirements
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

### Requirement: Item detail with candidate comparison

The system SHALL provide an item detail view led by a backdrop hero that displays the item's clearlogo (falling back to the title text when no logo exists), its rating, release year, and runtime for movies or season and episode counts for shows, its genres, and its overview, with the discover and apply actions available in the hero. Below the hero the system SHALL present the discovered MediaUX candidates grouped into sets, each set showing its uploader attribution with poster and backdrop together, and SHALL let the user stage a whole set or an individual piece, preview the current selection, and apply it via the chosen method(s). For shows the view SHALL additionally present season-poster sets and title-card sets. All of the view's own UI text — action buttons (discover/apply/revert), section and slot labels, and method/option labels — SHALL render in the active locale; movie/show titles, overviews, genres, and uploader names remain the upstream data values.

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

#### Scenario: Localized actions and labels

- **WHEN** the active locale is not English
- **THEN** the discover/apply/revert actions, section and slot labels, and method/option labels render in the active locale, while item titles, overviews, genres, and uploader names render as their upstream data values

### Requirement: Bulk actions

The system SHALL support selecting multiple items and running discovery and/or apply across the selection as a background job.

#### Scenario: Bulk apply

- **WHEN** the user selects multiple items and chooses bulk apply with automatic selection
- **THEN** the system starts a background job that discovers (if needed), auto-selects, and applies covers for each selected item, with live progress

### Requirement: Jobs view with live progress

The system SHALL provide a jobs view listing active and past jobs with live progress for running jobs and final status for completed ones. The view's own UI text — column headers, job-type and status labels, progress text, and action labels — SHALL render in the active locale.

#### Scenario: Live progress shown

- **WHEN** a job is running and the user opens the jobs view
- **THEN** the view shows a live progress indicator that updates without a manual refresh

#### Scenario: Localized job labels

- **WHEN** the active locale is not English
- **THEN** the jobs view's column headers, status and job-type labels, and progress text render in the active locale (falling back to English for any untranslated message)

### Requirement: Settings view

The system SHALL provide a settings view to enter and test the Plex URL/token, TMDB credential, Kometa assets directory, default apply method, and preferred UI language. The view's own UI text — field labels, helper text, validation messages, and action buttons — SHALL render in the active locale.

#### Scenario: Settings saved and validated

- **WHEN** the user enters configuration in settings and saves
- **THEN** the system validates connectivity (Plex and TMDB) and persists the configuration, reporting any validation failure inline

#### Scenario: Language selectable in settings

- **WHEN** the user selects a preferred UI language in settings and saves
- **THEN** the system persists it as the preferred-language setting and applies it as the active locale, consistent with the header language switcher

#### Scenario: Localized settings text

- **WHEN** the active locale is not English
- **THEN** the settings field labels, helper text, validation messages, and action buttons render in the active locale (falling back to English for any untranslated message)

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

The system SHALL render every page (Dashboard, Library, Item detail, Jobs, Settings) within a shared application shell using one consistent theme: a near-black background, a single accent color, a glassy sticky header with navigation, and consistent card styling. The shell header SHALL include a language switcher that is available on every page, and all of the shell's own text (navigation labels, the configure-to-get-started banner) SHALL render in the active locale.

#### Scenario: Consistent shell across pages

- **WHEN** the user navigates between any of the app's pages
- **THEN** each page renders within the same themed shell — shared header, accent color, and card styling

#### Scenario: Active navigation indicated

- **WHEN** the user is on a given page
- **THEN** the corresponding navigation item is visually marked as active

#### Scenario: Language switcher in the shell

- **WHEN** the user is on any page
- **THEN** the shell header shows a language switcher reflecting the active locale, and selecting another language re-renders the app in that locale

#### Scenario: Localized shell text

- **WHEN** the active locale is not English
- **THEN** the navigation labels and the configure-to-get-started banner render in the active locale (falling back to English for any untranslated message)

### Requirement: Candidates grouped by provider

The item detail view SHALL group artwork candidates first by provider and then by set within each provider, labelling each provider so the user can see where each cover came from.

#### Scenario: Multiple providers shown

- **WHEN** an item has candidates from more than one provider
- **THEN** the view shows a labelled section per provider, each containing that provider's sets

#### Scenario: Single provider

- **WHEN** an item has candidates from only one provider
- **THEN** the view shows that provider's sets under its label without empty sections for disabled or unproductive providers

### Requirement: Provider settings in the UI

The Settings view SHALL present a control to enable or disable each artwork provider and a field for the Fanart.tv API key, alongside the existing configuration fields.

#### Scenario: Provider controls rendered

- **WHEN** the user opens Settings
- **THEN** each provider has an enable toggle, and a Fanart.tv key field is shown (masked when already set)

### Requirement: Kometa manager navigation destination

The system SHALL expose the Kometa manager as a dedicated top-level navigation destination (a `/kometa` route), distinct from the Settings page. The Settings page SHALL no longer host the Kometa management UI; it MAY retain a brief pointer to the manager.

#### Scenario: Reachable from navigation

- **WHEN** the user opens the app navigation
- **THEN** a Kometa entry is present and links to the dedicated manager page

#### Scenario: Settings no longer manages Kometa

- **WHEN** the user opens Settings
- **THEN** the Kometa management UI is not there; at most a pointer to the dedicated page is shown

### Requirement: Cinematic spotlight on the Kometa manager

The system SHALL present a cinematic spotlight hero at the top of the Kometa manager page — an image-forward backdrop banner with the manager title and live status (such as config-file path, mode, file state, and managed-library count) overlaid — consistent with the app's image-forward identity, so the config-dense page does not read as a plain configuration dashboard. The spotlight SHALL honor `prefers-reduced-motion`, and all of its text SHALL render in the active locale.

#### Scenario: Spotlight rendered

- **WHEN** the user opens the Kometa manager page
- **THEN** a backdrop spotlight hero with the title and live status is shown above the management sections

#### Scenario: Reduced motion honored

- **WHEN** the user prefers reduced motion
- **THEN** any spotlight animation degrades to instant or a plain cross-fade

#### Scenario: No backdrop available

- **WHEN** no library backdrop is available to feature
- **THEN** the spotlight falls back to a static cinematic backdrop without error

### Requirement: Per-season artwork groups on the item detail

For a show, the item detail view SHALL organize a set's artwork into a show group (poster
and background) and one group per season, where each season group contains that season's
poster (from `season` candidates) and its episodes' title cards (from `title_card`
candidates). Season backgrounds are not rendered because no provider sources them. Each slot
SHALL be independently selectable and reflect its own staged state. All of the groups' own UI
text SHALL render in the active locale.

#### Scenario: Season groups rendered

- **WHEN** the user opens a show with a set that includes season and episode artwork
- **THEN** the view shows a show group and a per-season group, each season group listing that
  season's poster and its episodes' title cards

#### Scenario: Stage a season or episode slot independently

- **WHEN** the user selects a candidate inside a season or episode slot
- **THEN** that slot reflects the staged selection without changing the show-level or other
  slots' staged state

### Requirement: Stage a full set across seasons and episodes from the UI

The item detail view SHALL provide a "use this set" action that stages every slot the set
covers — show, each season, and each episode — and SHALL let the user subsequently override
any individual slot.

#### Scenario: Use set fills all slots

- **WHEN** the user chooses "use this set" on a set with season and episode artwork
- **THEN** the view stages the show, season, and episode slots from that set and reflects
  them as staged

#### Scenario: Override a single slot after using a set

- **WHEN** the user picks a different candidate for one slot after using a set
- **THEN** only that slot's staged selection changes and the rest stay staged

### Requirement: Collapsible provider, set, and season sections

The item detail view SHALL let the user collapse and expand each provider section, each set
card, and each season group. On first load the first provider and its first set SHALL be
expanded and the rest collapsed. Collapsed/expanded state SHALL persist in the browser so
it survives reloads and navigation between items.

#### Scenario: Default collapse state

- **WHEN** the user opens an item detail view for the first time
- **THEN** the first provider and its first set are expanded and all other providers, sets,
  and season groups are collapsed

#### Scenario: Collapse state persists

- **WHEN** the user collapses or expands a provider, set, or season and later reloads or
  returns to an item
- **THEN** the view restores that section's collapsed/expanded state from the browser

### Requirement: Staged-slot summary and single apply

The sticky builder on the item detail view SHALL summarize what is currently staged across
all slots (show poster/background plus counts of staged seasons and episodes), and a single
apply action SHALL apply everything staged via the chosen method(s). The summary text SHALL
render in the active locale.

#### Scenario: Summary reflects staged slots

- **WHEN** the user has staged the show poster and one or more season and episode slots
- **THEN** the sticky builder shows a summary of the staged show artwork and the staged
  season and episode counts

#### Scenario: Single apply writes all staged slots

- **WHEN** the user triggers apply with multiple slots staged
- **THEN** the system applies all staged slots in one action via the selected method(s)

### Requirement: Per-season revert control

Each season group on the item detail view SHALL offer a revert control that reverts that
season's poster/background and its episodes' title cards, in addition to the item-level
revert that reverts all applied artwork. The controls' text SHALL render in the active
locale.

#### Scenario: Revert one season from its group

- **WHEN** the user activates the revert control within a season group
- **THEN** the system reverts only that season's poster/background and its episodes' title
  cards, leaving show-level and other seasons' artwork in place

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


## ADDED Requirements

### Requirement: Actionable dashboard

The system SHALL present dashboard summaries for items needing review, unresolved matches, no-candidate items, partial failures, external artwork changes, and failed jobs, together with the next recommended action. Each summary SHALL show a current count and SHALL open the corresponding filtered workflow rather than a non-actionable statistics page.

#### Scenario: Review work is pending

- **WHEN** one or more items are ready for review
- **THEN** the dashboard shows the matching count and an action that opens those items in the review inbox

#### Scenario: A job has failed

- **WHEN** a job reaches failed or partial-failure status
- **THEN** the dashboard shows the failure count and links to the job details and retry workflow

#### Scenario: No action is pending

- **WHEN** there are no pending review entries or failed jobs in the active scope
- **THEN** the dashboard reports that the scope is up to date and offers the next safe synchronization action

### Requirement: Truthful and resumable setup UI

The setup UI SHALL persist progress only after each server request succeeds, SHALL remain on the current step with an inline error after a failed request, and SHALL restore the last completed step after navigation or restart. The first synchronization SHALL be shown as queued or running until its job reaches a terminal result, and setup SHALL claim completion only after success. A skip action SHALL leave setup and route to the usable application destination it names.

#### Scenario: Setup save fails

- **WHEN** a setup persistence or validation request returns an error
- **THEN** the UI remains on the current step, displays the returned error, and does not mark the step complete

#### Scenario: First synchronization is still running

- **WHEN** setup has enqueued the first synchronization but its job is not terminal
- **THEN** the UI shows its current queued or running progress and does not present setup as complete

#### Scenario: First synchronization fails

- **WHEN** the first synchronization reaches failed or partial-failure status
- **THEN** setup shows the failure details and retry action without discarding previously completed steps

#### Scenario: User skips an optional step

- **WHEN** the user activates a skip action
- **THEN** the UI leaves the skipped step and navigates to the destination stated by that action

### Requirement: Diagnostics UI

The system SHALL provide an accessible diagnostics view showing each configured server, TMDB, artwork provider, Kometa path, data path, and backup path with textual health, credential state, latency, last check, last success, and sanitized error information. The view SHALL let the user run checks and explicitly export a redacted support bundle without displaying or returning secret values.

#### Scenario: Diagnostic statuses are displayed

- **WHEN** the user opens diagnostics
- **THEN** each component shows a textual status and available timing or corrective information without relying on color alone

#### Scenario: User reruns checks

- **WHEN** the user requests a diagnostic run
- **THEN** the view displays per-component progress and updates each component independently as its check completes

#### Scenario: User exports support information

- **WHEN** the user confirms support-bundle export
- **THEN** the UI downloads the redacted bundle and never renders a configured password, token, or API key

### Requirement: Accessible workflow controls

The web UI SHALL meet WCAG AA contrast for text and interactive states, provide visible keyboard focus, accessible names and state for icon-only and custom controls, logical focus management for dialogs and route changes, status announcements for asynchronous operations, and non-color status indicators. Animation and auto-advancing imagery SHALL honor `prefers-reduced-motion` without removing access to content or actions.

#### Scenario: Workflow is operated by keyboard

- **WHEN** a user navigates a page without pointer input
- **THEN** every action is reachable in a logical order with visible focus and an accessible name and state

#### Scenario: Dialog closes

- **WHEN** the user closes or completes a modal dialog
- **THEN** focus returns to the control or next logical element that initiated the dialog

#### Scenario: Asynchronous action changes state

- **WHEN** a job, apply, save, or diagnostic action changes status
- **THEN** the UI exposes the new textual status and announces it without requiring visual polling

#### Scenario: Reduced motion is requested

- **WHEN** the operating system reports `prefers-reduced-motion: reduce`
- **THEN** non-essential motion and automatic transitions are removed or reduced while all content remains available

## MODIFIED Requirements

### Requirement: Library grid with filters and search

The system SHALL present the synced library as a paginated poster grid whose search, filters, sorting, and counts are evaluated server-side across the complete selected server/library scope. It SHALL be searchable by title and filterable by server, library, active/ignored state, media type (movie/show), poster state (missing poster), aggregate candidate availability, MediUX-specific availability, change state, minimum rating, and genre. The grid SHALL be sortable by title, release year, rating, runtime, most-recently-changed, and date added to the server (newest first by default; items without date-added data ordered last). When no sort is specified in the URL, the grid SHALL open with the sort named by the `libraryDefaultSort` setting. The grid SHALL report both the displayed range and total matching count, show a spotlight backdrop banner for a recently-changed item above the wall, and surface each tile's rating and provider-neutral status badges with title and year revealed on hover or keyboard focus. All of the grid's own UI text SHALL render in the active locale.

#### Scenario: Filter and search applied

- **WHEN** the user selects filters and/or types a search query
- **THEN** the server returns only matching items from the complete scope and the grid resets to a valid page with the total matching count

#### Scenario: Active and ignored filtering spans all pages

- **WHEN** the user selects all, active, or ignored state
- **THEN** the result is filtered across the full server-side result set rather than only the currently loaded page

#### Scenario: Provider availability filters are distinct

- **WHEN** the user filters by aggregate candidates or specifically by MediUX candidates
- **THEN** the grid uses the corresponding availability value and does not label another provider's candidates as MediUX

#### Scenario: Sort applied

- **WHEN** the user selects a sort option (title, year, rating, runtime, recently changed, or date added)
- **THEN** the complete filtered result is ordered server-side before pagination

#### Scenario: Date-added sort

- **WHEN** the user sorts by date added
- **THEN** items order newest-first by their server date-added, with items lacking the data placed last

#### Scenario: Configured default sort

- **WHEN** the library is opened without a sort URL parameter
- **THEN** the grid uses the sort named by the `libraryDefaultSort` setting (falling back to title)

#### Scenario: Rating and genre filtering

- **WHEN** the user sets a minimum rating and/or selects one or more genres
- **THEN** the server returns only items meeting the rating threshold and matching the selected genres

#### Scenario: Spotlight banner

- **WHEN** at least one item has had a cover applied
- **THEN** the library shows a spotlight backdrop banner for a recently-changed item above the poster wall

#### Scenario: Empty library

- **WHEN** no library has been synced yet
- **THEN** the grid shows a server-neutral empty state prompting the user to configure a media server and run a sync

#### Scenario: Localized controls and badges

- **WHEN** the active locale is not English
- **THEN** the filter/sort labels, control placeholders, status badges, count text, and empty-state text are rendered in the active locale

### Requirement: Item detail with candidate comparison

The system SHALL provide an item detail view led by a backdrop hero that displays the item's clearlogo (falling back to title text), rating, release year, runtime for movies or season and episode counts for shows, genres, and overview, with discover and apply actions available in the hero. Below the hero the system SHALL present artwork candidates grouped by provider and set with uploader attribution, poster and backdrop together, and for shows season posters and title cards. The user SHALL be able to compare current server artwork, suggested artwork, and staged artwork per slot; stage a whole set or individual piece; preview the selection; and apply it through the normal confirmation flow. When opened from library or review context, previous, next, and back actions SHALL preserve that query and position. All view-owned UI text SHALL render in the active locale; upstream metadata and uploader names remain upstream values.

#### Scenario: Hero with metadata

- **WHEN** the user opens an enriched item
- **THEN** the view shows the backdrop hero with logo or title, rating, year, runtime or season/episode counts, genres, overview, and current poster

#### Scenario: Compare and select by set

- **WHEN** the user opens an item with discovered candidates
- **THEN** candidates are grouped by provider and set with attribution, current and proposed slots can be compared, and the user can stage a set or individual artwork before apply

#### Scenario: Show artwork

- **WHEN** the opened item is a show with discovered candidates
- **THEN** the view also presents season-poster and title-card sets for that show

#### Scenario: No candidates yet

- **WHEN** the user opens an item whose covers have not been discovered
- **THEN** the view offers a find-covers action that runs discovery for that item

#### Scenario: Review context is preserved

- **WHEN** the user opens item detail from a filtered library or review inbox
- **THEN** previous, next, and back navigation remain within that context and restore its position

#### Scenario: Localized actions and labels

- **WHEN** the active locale is not English
- **THEN** discover, apply, revert, compare, navigation, section, slot, and option labels render in the active locale while upstream content remains unchanged

### Requirement: Bulk actions

The system SHALL support selecting the current page or every item matching the active server-side query and running discovery and/or apply across that selection as a background job. Before mutation, it SHALL materialize the exact target identifiers, show the selected and excluded counts and an exact operation preview, and bind confirmation to that target snapshot so newly matching or unpreviewed items are not included.

#### Scenario: Select the current page

- **WHEN** the user chooses select page
- **THEN** only eligible items loaded on that page become selected and the UI reports their count

#### Scenario: Select all matching results

- **WHEN** the user chooses select all for a query matching more than one page
- **THEN** the selection represents all eligible server-side matches and displays the full matching count

#### Scenario: Bulk apply

- **WHEN** the user confirms the exact bulk preview with automatic selection
- **THEN** the system starts a background job for only the previewed targets that discovers if needed, auto-selects required artwork, and applies it with live progress

#### Scenario: Query changes before confirmation

- **WHEN** filters or scope change after a select-all operation and before confirmation
- **THEN** the UI invalidates or recalculates the selection and requires a new exact preview

### Requirement: Jobs view with live progress

The system SHALL provide a jobs view listing active and past jobs with durable queued/running progress, terminal status, timing, attempt count, target summary, result summary, and sanitized error details. A queued job SHALL NOT appear complete merely because it was accepted. Failed and partially failed jobs SHALL expose retry for their failed work, creating a new recorded attempt without erasing prior outcomes. All view-owned UI text SHALL render in the active locale.

#### Scenario: Live progress shown

- **WHEN** a job is queued or running and the user opens the jobs view
- **THEN** the view shows its truthful current state and live progress without a manual refresh

#### Scenario: Failure details shown

- **WHEN** a job fails or partially fails
- **THEN** the view identifies failed targets and sanitized reasons while retaining successful results

#### Scenario: Failed work is retried

- **WHEN** the user retries an eligible failed or partially failed job
- **THEN** the system creates a new attempt for the failed work and preserves the original attempt and outcome

#### Scenario: Localized job labels

- **WHEN** the active locale is not English
- **THEN** column headers, statuses, job types, progress, error summaries, and action labels render in the active locale

### Requirement: Settings view

The system SHALL provide a settings view to manage provider-appropriate media-server connection data, the TMDB credential, Kometa paths, default apply method, and preferred UI language. Secret fields SHALL remain masked after persistence. The view SHALL allow relevant connection tests and SHALL render all field labels, helper text, validation messages, and actions in the active locale.

#### Scenario: Settings saved and validated

- **WHEN** the user enters configuration in settings and saves
- **THEN** the system validates the applicable media-server and TMDB connections, persists only valid configuration, and reports validation failures inline

#### Scenario: Server-specific connection fields

- **WHEN** the user edits a Plex, Jellyfin, or Emby connection
- **THEN** the view presents only the authentication fields supported by that server type and never reveals a stored credential

#### Scenario: Language selectable in settings

- **WHEN** the user selects a preferred UI language in settings and saves
- **THEN** the system persists it and applies it as the active locale, consistent with the header language switcher

#### Scenario: Localized settings text

- **WHEN** the active locale is not English
- **THEN** settings labels, helper text, validation messages, and actions render in the active locale

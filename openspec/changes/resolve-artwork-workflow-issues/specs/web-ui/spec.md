## ADDED Requirements

### Requirement: Show server-scoped TMDB normalization status

The application shell SHALL show a localized, non-dismissible normalization banner when the active media-server instance has pending legacy automatic TMDB type mismatches. The banner SHALL derive from durable server and job state rather than browser-local storage, show the pending count, and offer an action that starts or resumes selective server-scoped repair. It SHALL remain visible until the active server's pending count reaches zero.

#### Scenario: Pending normalization is shown

- **WHEN** the active server has pending mismatches and no repair job is active
- **THEN** the shell shows the pending count, a concise explanation, and a localized repair action

#### Scenario: Repair is in progress

- **WHEN** a matching repair job is pending, running, or retry-scheduled
- **THEN** the banner shows an in-progress state, links to durable job progress, and prevents duplicate repair submission

#### Scenario: Repair succeeds

- **WHEN** repair finishes and the active server's durable pending count is zero
- **THEN** the banner disappears after server and job state refresh

#### Scenario: Repair remains incomplete

- **WHEN** repair is partial-failed, failed, cancelled, or interrupted and pending items remain
- **THEN** the banner remains visible, reports that normalization is incomplete, and offers retry or job-detail navigation

#### Scenario: Active server changes

- **WHEN** the user switches media-server instances
- **THEN** the banner and pending count update to the newly active server without carrying state from the previous server

#### Scenario: No legacy mismatch exists

- **WHEN** the active server has no eligible legacy mismatch, including on a fresh installation
- **THEN** the normalization banner is absent

### Requirement: TMDB artwork language controls

The item detail view SHALL filter TMDB artwork using the global artwork-language preference and SHALL provide an item-local control to switch temporarily between preferred-language results and all languages. Language eligibility SHALL be evaluated before batching, counts, visible suggestions, and progressive disclosure.

#### Scenario: Preferred-language artwork exists

- **WHEN** the user prefers a language and artwork tagged with that language or explicitly untagged artwork exists
- **THEN** the preferred view shows those candidates and excludes candidates tagged with other languages

#### Scenario: No preferred-language artwork exists

- **WHEN** no preferred-language or explicitly untagged candidate exists
- **THEN** the view presents a localized empty state and an explicit action to show all languages rather than silently violating the preference

#### Scenario: Local override selected

- **WHEN** the user chooses all languages for the current item
- **THEN** all retained TMDB candidates become available without changing the global preference

#### Scenario: Automatic fallback is visible

- **WHEN** automatic selection uses a foreign-language fallback
- **THEN** the selected candidate is made visible and labelled as a language fallback rather than appearing as a hidden suggestion

#### Scenario: Legacy language provenance is unknown

- **WHEN** restricted filtering encounters legacy TMDB candidates without reliable language provenance
- **THEN** the view requests refreshed discovery and does not silently classify them as untagged

### Requirement: Progressive artwork candidate disclosure

Each provider and artwork-kind pane SHALL render a bounded initial batch and a localized load-more control whenever undisplayed candidates remain. Poster and backdrop disclosure SHALL be independent and SHALL not use infinite scrolling.

#### Scenario: More candidates are available

- **WHEN** a pane contains candidates beyond its visible batch
- **THEN** it shows a keyboard-operable control reporting how many candidates will be revealed and how many remain

#### Scenario: User loads more candidates

- **WHEN** the user activates the control
- **THEN** the next batch is appended in stable order, focus and scroll context are preserved, and a polite live region announces the updated count

#### Scenario: Filter changes

- **WHEN** the artwork-language filter changes
- **THEN** the visible batch and remaining count are recalculated from the filtered inventory

#### Scenario: Candidates remain undisclosed

- **WHEN** candidates have not yet been revealed
- **THEN** their image elements are not mounted or eagerly downloaded

#### Scenario: Provider inventory was truncated

- **WHEN** discovery reached its defensive source limit
- **THEN** the pane communicates that the retained inventory was truncated rather than claiming every provider result is present

### Requirement: Accessible enlarged artwork preview

Every artwork candidate SHALL offer an enlarged preview action independent of staging. Selection and preview SHALL be separate sibling controls rather than nested interactive elements. The preview SHALL work with mouse, keyboard, and touch and present the complete canonical image without cropping in an accessible modal dialog.

#### Scenario: Preview opened without staging

- **WHEN** the user activates a candidate's preview control
- **THEN** the dialog opens without selecting, clearing, or changing any staged slot

#### Scenario: Keyboard dialog operation

- **WHEN** the preview is open
- **THEN** focus is trapped in the dialog, Escape closes it, global page shortcuts are suspended, and focus returns to the exact preview trigger

#### Scenario: Preview closed by pointer

- **WHEN** the user activates the close control or permitted backdrop close behavior
- **THEN** the dialog closes without changing staged artwork

#### Scenario: Navigate visible candidates

- **WHEN** previous and next navigation is available
- **THEN** it moves only through the current filtered and disclosed candidate sequence and announces the position

#### Scenario: Reduced motion and image failure

- **WHEN** reduced motion is preferred or the full-size image fails to load
- **THEN** the dialog avoids nonessential motion and presents an accessible localized error state when needed

### Requirement: Present truthful artwork coverage

The library, review, and item views SHALL present current artwork coverage using distinct localized states for direct application on a media server, export to Kometa metadata, externally changed or unknown evidence, and missing coverage. A Kometa metadata entry SHALL be labelled exported to Kometa and SHALL NOT be labelled applied unless independent downstream application evidence exists.

#### Scenario: Direct and Kometa coverage differ

- **WHEN** an item has verified direct-server artwork and a Kometa entry for only some slots
- **THEN** the UI reports each destination and slot independently rather than collapsing them into one completed state

#### Scenario: Matching occurrences exist

- **WHEN** the same canonical media identity occurs across multiple known servers or libraries
- **THEN** item details can report the covered occurrence count and the library grid shows the current occurrence's destination states

#### Scenario: Filter by coverage

- **WHEN** the user selects applied-on-this-server, exported-to-Kometa, needs-artwork, or unknown coverage
- **THEN** the library or review list returns occurrences matching that derived state

#### Scenario: Coverage is not workflow completion

- **WHEN** coverage changes because a destination is reconciled
- **THEN** the system does not mutate the user's reviewed state solely because of that coverage change

#### Scenario: Accessible coverage presentation

- **WHEN** coverage is shown as a badge, icon, count, or filter
- **THEN** it includes localized text and is not conveyed by color alone

## MODIFIED Requirements

### Requirement: Item detail with candidate comparison

The system SHALL provide an item detail view led by a backdrop hero that displays the item's clearlogo, falling back to title text, plus rating, release year, runtime for movies or season and episode counts for shows, genres, and overview, with discover and apply actions available in the hero. Below the hero the system SHALL present eligible discovered candidates from all providers grouped first by provider and then by set, with provider and uploader attribution, and SHALL let the user stage a whole set or individual piece, preview candidates independently, and apply through the chosen methods. For shows the view SHALL additionally present season-poster and title-card sets. All UI-authored text SHALL render in the active locale while upstream media and attribution values remain unchanged.

#### Scenario: Hero with metadata

- **WHEN** the user opens an enriched item
- **THEN** the view shows the backdrop hero with logo or title, rating, year, runtime or season and episode counts, genres, overview, and current poster

#### Scenario: Compare and select by provider and set

- **WHEN** the user opens an item with discovered candidates
- **THEN** eligible candidates are grouped by provider and set with attribution and the user can stage a set or individual artwork piece

#### Scenario: Show artwork

- **WHEN** the opened item is a show with discovered candidates
- **THEN** the view also presents season-poster and title-card sets for that show

#### Scenario: No candidates yet

- **WHEN** the user opens an item whose artwork has not been discovered
- **THEN** the view offers a find-artwork action for that item

#### Scenario: Localized actions and labels

- **WHEN** the active locale is not English
- **THEN** actions, section and slot labels, filters, and method labels render in the active locale while upstream content retains its source values

### Requirement: Candidates grouped by provider

The item detail view SHALL group artwork candidates first by provider and then by set within each provider. Productive provider groups SHALL follow canonical configured provider order, and the first productive provider in that order SHALL be the provider expanded by default. Candidate insertion or response order SHALL not affect presentation.

#### Scenario: Multiple providers shown

- **WHEN** an item has candidates from more than one provider
- **THEN** the view shows a labelled section per productive provider in canonical order, each containing that provider's sets

#### Scenario: Single provider

- **WHEN** an item has candidates from only one provider
- **THEN** the view shows that provider's sets under its label without empty sections

#### Scenario: Stored order differs

- **WHEN** candidate records were inserted in an order different from canonical provider order
- **THEN** group order and the default expanded group still follow canonical order

### Requirement: Provider settings in the UI

The Settings view SHALL present provider enablement and credential controls together with one canonical provider-order control in the Providers section. Each row SHALL show the provider's position and enabled state. Reordering SHALL support drag by a dedicated handle plus always-available move-up and move-down controls, and changes SHALL persist through the existing Settings save action. Scoring weights SHALL remain distinct and SHALL explain that order affects presentation and equal-score tie-breaking rather than overriding unequal scores.

#### Scenario: Provider controls rendered

- **WHEN** the user opens Provider settings
- **THEN** each provider has its enablement control, credential state where applicable, position, drag handle, and move buttons

#### Scenario: Provider moved by pointer

- **WHEN** the user drags a provider by its dedicated handle with mouse or touch
- **THEN** the row moves without making the entire row draggable or preventing normal page scrolling outside the handle

#### Scenario: Provider moved without drag

- **WHEN** the user activates a localized move-up or move-down button
- **THEN** the same reorder operation occurs and focus remains associated with the moved provider

#### Scenario: Reorder announced

- **WHEN** a provider changes position
- **THEN** visible position text and a polite live region announce its new position without relying on color alone

#### Scenario: Disabled provider remains ordered

- **WHEN** a provider is disabled
- **THEN** it remains visibly positioned with a disabled label so re-enablement restores the same place

#### Scenario: Reduced motion requested

- **WHEN** the user prefers reduced motion
- **THEN** provider reordering occurs without nonessential movement animation

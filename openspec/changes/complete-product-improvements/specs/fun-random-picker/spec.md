## MODIFIED Requirements

### Requirement: Random movie/series picker

The Fun section SHALL offer a night picker that samples up to three distinct items uniformly without replacement from the synced items eligible under the user's criteria: one named library or all libraries on the selected server; media type (movie, show, or both); a single genre drawn from the eligible genre list (or all genres); an optional release-year range; whether watched items are included (included by default); an optional runtime range; an optional minimum rating; an optional added-within recency window; and a named preset that populates a documented combination of those filters. Before a draw, the picker SHALL validate range inputs and report the exact eligible-item count. A normal draw SHALL return three items when at least three are eligible and all eligible items otherwise, and SHALL avoid items from the user's recent picker history when enough other eligible items exist. Each result SHALL be image-forward — poster (or placeholder when missing), title, year, type, genres, runtime, and rating/overview when available — with a link to the item's detail page and a re-roll control that draws a new result under the same filters.

Each successful draw SHALL have a seed and normalized filter state encoded in a shareable PosterPilot URL without credentials or other secrets. Reopening that URL SHALL reproduce the same ordered item identifiers while those items remain available and SHALL explain any item that is no longer available rather than silently replacing it. A re-roll SHALL generate a new seed. Eligibility counts, validation errors, filter labels, presets, results, and empty states SHALL render in the active locale.

#### Scenario: Pick with default filters

- **WHEN** the user triggers a pick with no filters changed and at least three items are synced on the selected server
- **THEN** the system returns three distinct random items from all of that server's libraries (movies and shows, all genres, all years and runtimes, watched included) and displays each with its poster or placeholder and available metadata

#### Scenario: Existing filters applied

- **WHEN** the user restricts the pick by media type, genre, and/or release-year range
- **THEN** every returned item satisfies every active filter

#### Scenario: Library filter applied

- **WHEN** the user selects a named library before drawing
- **THEN** the eligible count and every returned item are limited to that library on the selected server

#### Scenario: Runtime rating and recency filters applied

- **WHEN** the user specifies a runtime range, minimum rating, and/or added-within recency window
- **THEN** the eligible count and every returned item use the normalized runtime, rating, and server date-added values and exclude items missing a value required by an active filter

#### Scenario: Preset selected

- **WHEN** the user selects a named picker preset
- **THEN** the picker displays the preset's documented filter values, applies them to the eligible count and draw, and lets the user further narrow them before drawing

#### Scenario: Watched items excluded

- **WHEN** the user sets the picker to exclude watched items
- **THEN** every returned item has a false synced watched flag, with items never synced with watched data treated as unwatched

#### Scenario: Eligibility count reported

- **WHEN** the user changes any picker criterion
- **THEN** the system reports the exact number of synced items satisfying the complete normalized filter set before a draw is made

#### Scenario: Invalid range rejected

- **WHEN** a minimum year or runtime is greater than its corresponding maximum, a runtime is negative, or a rating falls outside the supported scale
- **THEN** the system shows a localized field-level validation error and does not draw until the criteria are valid

#### Scenario: Recent repeats can be avoided

- **WHEN** at least three eligible items are not present in the user's bounded recent-picker history
- **THEN** a new draw returns only items outside that recent history and records the returned identifiers for subsequent draws

#### Scenario: Small pool permits recent items

- **WHEN** fewer than three eligible items remain after excluding recent history but eligible items do exist
- **THEN** the system relaxes only the recent-history exclusion, never the user's filters, and still returns distinct items

#### Scenario: Re-roll

- **WHEN** the user triggers the re-roll control
- **THEN** the system keeps the same normalized filters, creates a new seed, and draws another distinct result set while applying the recent-repeat rule

#### Scenario: Share and reopen a result

- **WHEN** a user opens the shareable URL from a successful draw and all referenced items still exist on that PosterPilot installation
- **THEN** the system restores the normalized filters and displays the same items in the same order without performing a new draw

#### Scenario: Shared item no longer exists

- **WHEN** a shared result references an item that was removed or is no longer visible on the selected server
- **THEN** the system marks that result unavailable, keeps the remaining original results, and offers an explicit new draw instead of substituting another item

#### Scenario: Fewer than three items match

- **WHEN** one or two synced items satisfy the active filters
- **THEN** the system returns every matching item exactly once and explains that the eligible pool contains fewer than three choices

#### Scenario: No item matches

- **WHEN** no synced item satisfies the active filters
- **THEN** the system shows a localized empty state explaining that the eligible count is zero, suggests changing filters, and does not report an application error

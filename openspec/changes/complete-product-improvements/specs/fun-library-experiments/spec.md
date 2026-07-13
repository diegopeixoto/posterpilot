## ADDED Requirements

### Requirement: Optional experiment hub

The Fun section SHALL present its library experiments as an image-forward hub only when the existing `funEnabled` setting is effective. Every experiment SHALL operate only on items and artwork already available to PosterPilot, SHALL explain why an experiment is unavailable or has no eligible results, and SHALL NOT apply artwork or mutate media-server state without handing the user to an explicit preview-and-confirm application flow.

#### Scenario: Fun experiments are disabled

- **WHEN** `funEnabled` is false and a user requests a Fun experiment route directly
- **THEN** the system returns the same not-found response used for the disabled Fun section and performs no experiment work

#### Scenario: Experiment has no eligible inputs

- **WHEN** an enabled experiment cannot find enough synced items or artwork candidates to run
- **THEN** the hub shows a localized explanation and a way to change the relevant filters or return to the library, without treating the condition as an application error

#### Scenario: Experiment reaches an artwork decision

- **WHEN** a Fun experiment produces or selects a preferred artwork candidate
- **THEN** the system keeps the candidate staged for review and does not write it to a media server or Kometa until the user completes the normal preview-and-confirm flow

### Requirement: Poster match tournament

The Fun section SHALL offer a poster match for one synced title with at least two available poster candidates. A match SHALL compare two candidates at a time without exposing provider ranking as the preferred answer, advance the user's winner through a finite bracket until one candidate remains, and retain provider, candidate URL, title, and item provenance for the winning candidate. The user SHALL be able to abandon or restart the match, and the final candidate SHALL be staged rather than automatically applied.

#### Scenario: Start a poster match

- **WHEN** the user starts a poster match for an item with two or more poster candidates
- **THEN** the system creates a finite comparison bracket for that item and shows two distinct candidates side by side

#### Scenario: Advance a winner

- **WHEN** the user chooses one candidate in a comparison
- **THEN** the chosen candidate advances, the rejected candidate is removed from that match, and the next comparison contains no duplicate candidate

#### Scenario: Complete a poster match

- **WHEN** only one candidate remains in the bracket
- **THEN** the system identifies it as the winner with its original provenance and offers to stage it in the item's review flow without applying it

#### Scenario: Candidate becomes unavailable

- **WHEN** a candidate cannot be loaded during an active match
- **THEN** the system marks that candidate unavailable and continues with the remaining valid bracket when at least two candidates remain, or explains that the match can no longer continue

### Requirement: Ambient artwork gallery

The Fun section SHALL provide a full-screen ambient gallery using eligible synced posters and backgrounds. The gallery SHALL offer poster, background, or mixed modes; library and media-type filters; previous, next, pause, resume, and exit controls; and an adjustable transition interval. Controls SHALL remain keyboard accessible and become visually unobtrusive while idle. Automatic transitions SHALL be disabled when `prefers-reduced-motion: reduce` is active unless the user explicitly starts playback for the current session.

#### Scenario: Start an ambient gallery

- **WHEN** the user starts the gallery with a library, media type, and artwork mode selected
- **THEN** the system enters the full-screen gallery and displays only eligible artwork satisfying those selections

#### Scenario: Control gallery playback

- **WHEN** the user pauses, resumes, moves to the previous or next image, changes the interval, or exits
- **THEN** the gallery performs that action without losing the user's current filters

#### Scenario: Reduced motion is preferred

- **WHEN** the gallery opens while the browser reports `prefers-reduced-motion: reduce`
- **THEN** automatic transitions remain paused and artwork changes only through manual navigation until the user explicitly starts playback

#### Scenario: Artwork fails to load

- **WHEN** the current gallery image cannot be loaded
- **THEN** the gallery skips it, records it as unavailable for the current session, and continues without showing a broken-image surface

### Requirement: Blind and capsule picks

The Fun section SHALL offer blind picks that initially conceal title and artwork while showing only available non-identifying clues such as media type, release year, genres, runtime, rating, and tagline, plus an explicit reveal action. It SHALL also offer named capsule presets derived from synced facts, including recently added and unwatched items and older unwatched items. Before drawing, the system SHALL report the number of eligible items; a reveal SHALL preserve the exact selected item and provide a link to its detail page.

#### Scenario: Draw a blind pick

- **WHEN** the user draws from a filter set with eligible items
- **THEN** the system selects one eligible item, hides its title and artwork, and shows only the clues available for that item

#### Scenario: Reveal a blind pick

- **WHEN** the user activates reveal on a blind pick
- **THEN** the system reveals the same item's title and artwork and offers a link to its detail page

#### Scenario: Draw from a capsule preset

- **WHEN** the user selects a capsule such as recently added and unwatched
- **THEN** the system shows the preset's eligibility rule and count and draws only from items satisfying that rule

#### Scenario: Capsule has no matches

- **WHEN** no synced item satisfies a capsule's rule and active library filters
- **THEN** the system shows a localized zero-match state and does not silently broaden the rule

### Requirement: Duration-budget session planner

The Fun section SHALL build a session of two or three distinct movies whose combined known runtime does not exceed a user-supplied duration budget. The planner SHALL support library, genre, watched-state, and minimum-rating filters, exclude items without a usable runtime, report the eligible-item count before planning, and use a new seed when the user requests another plan. A generated plan SHALL show each movie's runtime and the combined runtime and SHALL link every movie to its detail page.

#### Scenario: Build a double feature

- **WHEN** the user requests two movies with a duration budget and at least one valid combination satisfies all active filters
- **THEN** the system returns two distinct matching movies whose displayed combined runtime is no greater than the budget

#### Scenario: Build a triple feature

- **WHEN** the user requests three movies and a valid three-item combination exists
- **THEN** the system returns three distinct matching movies within the budget

#### Scenario: Runtime is unknown

- **WHEN** a movie has no positive normalized runtime
- **THEN** the planner excludes it from budget calculations and reports that only items with known runtime are eligible

#### Scenario: No combination fits

- **WHEN** enough individual movies match the filters but no two- or three-item combination fits the duration budget
- **THEN** the system reports that no session fits the budget and suggests changing the budget or filters without returning an over-budget plan

#### Scenario: Re-plan under the same constraints

- **WHEN** the user requests another session
- **THEN** the system keeps the active constraints, uses a new random seed, and returns another valid combination when one is available

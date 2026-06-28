## ADDED Requirements

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

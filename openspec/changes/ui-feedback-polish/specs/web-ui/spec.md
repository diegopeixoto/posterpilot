## ADDED Requirements

### Requirement: Feedback on asynchronous actions

The system SHALL give the user clear, accessible feedback for asynchronous actions (save, apply, sync,
refresh, clear), surfacing transient success and error states through an ARIA live region and keeping
errors visible and actionable. Motion SHALL honor `prefers-reduced-motion`.

#### Scenario: Success feedback

- **WHEN** an asynchronous action completes successfully
- **THEN** the system shows a transient success notification announced to assistive technology, which
  dismisses on its own

#### Scenario: Error feedback persists

- **WHEN** an asynchronous action fails
- **THEN** the system shows an error the user can read and act on, not a transient flash

### Requirement: Loading states without layout shift

The system SHALL present skeleton placeholders for content-heavy views (library grid, item detail,
settings/activity) while their data loads, so the layout does not jump when content arrives.

#### Scenario: Skeleton during load

- **WHEN** a content-heavy view is loading its data
- **THEN** the system shows a skeleton matching the eventual layout, and content replaces it without a
  visible layout shift

### Requirement: Keyboard operability of primary flows

The system SHALL make the primary flows — library grid, item-detail selection, bulk actions, and
modals/popovers — fully keyboard-operable: logical focus order, visible focus, `Esc` to dismiss
overlays, and focus trapped within open overlays and returned to the trigger on close.

#### Scenario: Overlay keyboard handling

- **WHEN** a modal or popover is open and the user presses `Esc`
- **THEN** it closes and focus returns to the control that opened it

#### Scenario: Focus is visible

- **WHEN** the user navigates with the keyboard
- **THEN** the focused control shows a visible focus indicator meeting AA contrast

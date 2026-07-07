## ADDED Requirements

### Requirement: Composed page components

Large page views SHALL be composed of focused subcomponents with explicit prop/callback contracts
rather than single monolithic files, so they stay reviewable and safe to change. The decomposition
SHALL be behavior-preserving — no change to rendered output, behavior, or localized text.

#### Scenario: Settings tabs are separate components

- **WHEN** the Settings page is built
- **THEN** each tab is its own component with an explicit contract, and the page acts as a thin shell,
  with identical behavior to before

#### Scenario: Library concerns are separated

- **WHEN** the library page is built
- **THEN** the toolbar/filters, grid, and spotlight are separate components, with the page behavior
  unchanged

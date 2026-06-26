## ADDED Requirements

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

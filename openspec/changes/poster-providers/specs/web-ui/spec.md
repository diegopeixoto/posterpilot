## ADDED Requirements

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

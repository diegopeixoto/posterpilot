## ADDED Requirements

### Requirement: Cross-provider auto-selection

Automatic selection SHALL operate across all providers' candidates for an item rather than only MediUX, choosing a primary poster (and where available a background) from the available providers using a deterministic preference order.

#### Scenario: Auto-select with multiple providers

- **WHEN** the user requests automatic selection for an item that has candidates from several providers
- **THEN** the system selects a primary poster from the available providers by a deterministic preference order and records it as the pending selection

#### Scenario: Auto-select falls back across providers

- **WHEN** the most-preferred provider has no poster candidate for the item
- **THEN** the system falls back to the next provider that does, rather than returning no selection

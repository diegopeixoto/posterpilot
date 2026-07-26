# documentation — delta

## ADDED Requirements

### Requirement: French docs locale
The docs site SHALL offer French (`fr`) in its locale set with translated pages,
falling back to English for any page not yet translated, consistent with the other
non-English locales.

#### Scenario: French selectable in docs
- **WHEN** a visitor opens the docs language picker
- **THEN** Français is offered and French pages render under the `fr/` path

### Requirement: Adopted features are documented
The docs SHALL document ThePosterDB account login (what it changes, how to configure
credentials safely), collection discovery, per-provider re-search, and the one-click
apply behavior, in every docs locale.

#### Scenario: Feature docs at locale parity
- **WHEN** a feature page exists in English
- **THEN** each docs locale carries its translation (or the English fallback until translated)

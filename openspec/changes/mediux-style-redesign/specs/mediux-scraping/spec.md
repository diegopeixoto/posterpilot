## MODIFIED Requirements

### Requirement: Extract poster candidates from a set

The system SHALL extract each set's artwork from the embedded page data, producing candidate entries that include the asset URL, the kind (poster, background, season poster, or episode title card) with season/episode numbers where applicable, the owning set identifier, and the set's uploader attribution (author) when present in the payload. Candidates SHALL remain grouped by set so the UI can present each set as a unit.

#### Scenario: Candidates extracted

- **WHEN** a set page is loaded
- **THEN** the system parses the embedded JSON payload and returns poster and background candidates with absolute asset URLs, their kind, and the set they belong to

#### Scenario: Set attribution captured

- **WHEN** the embedded payload includes the uploader/author for a set
- **THEN** the system records that author on the set's candidates so the item page can show who made the set

#### Scenario: Attribution missing

- **WHEN** the embedded payload has no identifiable author for a set
- **THEN** the system records the set's candidates with no author and continues without failing

#### Scenario: Page structure changed

- **WHEN** the embedded payload cannot be parsed in the expected shape
- **THEN** the system records a parse failure for that set, skips it, and continues with the remaining sets rather than aborting the whole item

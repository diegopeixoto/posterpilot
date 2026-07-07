## ADDED Requirements

### Requirement: Kometa config-sync test coverage

The system SHALL have automated unit-test coverage over the pure core of the Kometa config-sync logic:
the surgical `merge` (managed keys updated; unmanaged keys and comments preserved), the `own`-mode full
regenerate, the snapshot/diff that computes removals, and the YAML round-trip — so a regression that
could corrupt a user's `config.yml` is caught before merge.

#### Scenario: Merge preserves unmanaged content

- **WHEN** the merge test runs against a fixture with unmanaged keys and comments
- **THEN** the test asserts the managed sections are updated and the unmanaged keys and comments are
  preserved unchanged

#### Scenario: Removal diff covered

- **WHEN** the snapshot/diff test runs
- **THEN** it asserts that keys removed since the last-applied snapshot are correctly identified for
  removal

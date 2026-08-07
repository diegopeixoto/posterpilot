## ADDED Requirements

### Requirement: Migrate the legacy single metadata file safely

When PosterPilot detects a legacy `posterpilot.yml` file or a PosterPilot-managed library reference to it, the system SHALL present a migration preview before changing metadata or configuration. The preview SHALL list the new movie and show files, every confidently classified and re-keyed entry, every ambiguous or unmatched legacy entry, each per-library reference change, and all source fingerprints.

Classification SHALL use authoritative bound-server item types and known TMDB, TVDB, and IMDb mappings or revision provenance. The system SHALL NOT infer media kind solely from an untyped numeric YAML key. Show entries migrated from legacy TMDB keys SHALL be re-keyed to a supported TVDB or IMDb identifier.

On confirmation, the system SHALL write and verify the split files before rewiring `config.yml`. A failure before configuration update SHALL leave the existing configuration active. The legacy file SHALL remain unchanged for rollback and SHALL NOT be automatically deleted. Ambiguous or unrecoverable entries SHALL be reported for explicit reapplication rather than silently assigned or discarded.

#### Scenario: Legacy layout is detected

- **WHEN** `posterpilot.yml` exists or a managed library references it
- **THEN** the manager reports that the legacy layout requires migration and offers a preview without modifying any file

#### Scenario: Unambiguous legacy entries are migrated

- **WHEN** authoritative item mappings classify legacy movie and show entries without ambiguity and the user confirms migration
- **THEN** the system writes those entries to their typed files using the correct identifier namespace, verifies both files, and then rewires each managed library

#### Scenario: Legacy numeric key is ambiguous

- **WHEN** a legacy numeric key cannot be proven to belong to one media kind or represents data already lost through a collision
- **THEN** the preview identifies it as ambiguous, omits it from automatic migration, and instructs the user to reapply affected artwork

#### Scenario: Split-file write fails

- **WHEN** either generated metadata file cannot be written or verified during migration
- **THEN** the system leaves `config.yml` and the legacy file unchanged and reports the failed migration

#### Scenario: Migration is cancelled or stale

- **WHEN** the user cancels migration or a source fingerprint changes after preview
- **THEN** the system writes nothing and requires a fresh preview

#### Scenario: Migration succeeds

- **WHEN** both split files are verified and the config update succeeds
- **THEN** each library references its correct file, the legacy file remains available for rollback, and subsequent exports use only typed split destinations

#### Scenario: Config manager is inactive

- **WHEN** PosterPilot does not manage `config.yml`
- **THEN** the system provides exact per-library split-file configuration instructions and does not claim migration is active until the user acknowledges manual wiring

#### Scenario: Legacy revisions remain isolated

- **WHEN** migration establishes the split-file baseline
- **THEN** new revisions target split files while pre-migration revisions remain associated with their provable legacy destination and are never remapped by numeric identifier

## MODIFIED Requirements

### Requirement: Sync libraries and wire the metadata file

The system SHALL build the `libraries:` section from selected managed libraries and SHALL wire each library to the PosterPilot metadata file appropriate to its authoritative library type. A movie library SHALL contain one PosterPilot-managed `metadata_files` entry for `posterpilot-movies.yml`; a show library SHALL contain one for `posterpilot-shows.yml`. A managed library SHALL NOT be wired to both generated files.

Both files SHALL be located in the same directory as `config.yml`, and each managed entry SHALL use the configured Kometa-visible relative prefix when required. Re-running sync SHALL be idempotent and SHALL NOT duplicate managed entries. PosterPilot SHALL replace only obsolete PosterPilot-managed references and SHALL preserve user-authored metadata files, comments, and sibling entries. Deselecting a library SHALL remove only PosterPilot-managed entries.

#### Scenario: Fresh movie and show libraries are wired

- **WHEN** a movie library and show library are selected on a fresh configuration
- **THEN** the movie library references only `posterpilot-movies.yml` and the show library references only `posterpilot-shows.yml`

#### Scenario: Library type determines its file

- **WHEN** a managed library has an authoritative media-server type
- **THEN** the system chooses its PosterPilot metadata file from that type rather than its display name or artwork-provider match type

#### Scenario: Sync is repeated

- **WHEN** sync runs again with unchanged library selections
- **THEN** each managed library still has exactly one correct PosterPilot metadata reference

#### Scenario: Incorrect managed split reference is repaired

- **WHEN** a movie library contains a PosterPilot-managed show-file reference or vice versa
- **THEN** the preview replaces the incorrect managed reference without changing user-authored metadata entries

#### Scenario: Relative-prefix override is configured

- **WHEN** Kometa must see generated files through a relative path prefix
- **THEN** both media-kind-specific references use that prefix while the physical files remain co-located with `config.yml`

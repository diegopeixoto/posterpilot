## ADDED Requirements

### Requirement: Manage service connectors

The system SHALL provide structured management of Kometa's service connector sections — at minimum `plex`, `tmdb`, `tautulli`, `trakt`, `mdblist`, `omdb`, `github`, `radarr`, `sonarr`, `notifiarr`, `gotify`, `ntfy`, `anidb`, and `mal` — driven by a connector catalog describing each section's fields (label, key, type, whether secret). Secret fields SHALL be masked, write-only, and redacted in previews. The system SHALL write only the fields the user provides and SHALL remove a managed connector field when the user clears it, leaving unmanaged keys in that section intact.

#### Scenario: Configure a connector

- **WHEN** the user fills a connector's fields (e.g. `tautulli` url + apikey) and syncs
- **THEN** the system writes those keys under that connector section, masking the secret in the preview, and preserves any other keys already present in that section

#### Scenario: Clear a managed connector field

- **WHEN** the user clears a connector field it previously managed and syncs
- **THEN** the system removes that key and leaves the rest of the section and unmanaged keys untouched

### Requirement: Manage per-library overlays

The system SHALL let the user enable or disable Kometa default overlay sets per library (e.g. `mediastinger`, `resolution`, `audio_codec`, `ribbon`, `network`) from a known overlay catalog, managing the matching `- default: <name>` entries in each library's `overlay_files`, preserving any non-default or user-authored overlay entries.

#### Scenario: Toggle overlays for a library

- **WHEN** the user enables `mediastinger` and `resolution` overlays for a library and syncs
- **THEN** the library's `overlay_files` contains `- default: mediastinger` and `- default: resolution`, and the user's other overlay entries are preserved

### Requirement: Manage per-library operations and setting overrides

The system SHALL let the user manage a known set of per-library `operations` (e.g. `mass_*`, `remove_overlays`, `delete_collections`, `assets_for_all`) and per-library `settings` overrides, writing only the keys the user sets and removing only keys it previously managed.

#### Scenario: Set a library operation

- **WHEN** the user enables a library operation and syncs
- **THEN** the system writes that operation key under the library's `operations`, preserving other operations the user authored

### Requirement: Edit the raw configuration file

The system SHALL provide a raw editor for the full `config.yml` that validates YAML on save, shows a diff against the current file, and writes through the same atomic backup-and-replace path as a structured sync. A parse error SHALL block the write and be reported inline. After a raw save, structured views SHALL reflect the new file content.

#### Scenario: Raw edit saved

- **WHEN** the user edits the raw config and saves valid YAML
- **THEN** the system shows a diff, writes the file atomically with a backup, and the structured views re-render from the new content

#### Scenario: Raw edit rejected

- **WHEN** the user saves raw content that is not valid YAML
- **THEN** the system reports the parse error inline and does not write the file

### Requirement: List and restore backups

The system SHALL list the timestamped backups it has written for the config file and SHALL let the user restore one. Restoring SHALL itself back up the current file before replacing it, and SHALL be confirmed before it runs.

#### Scenario: Restore a backup

- **WHEN** the user restores a listed backup
- **THEN** the system backs up the current file, writes the chosen backup's content over it atomically, and the restored content is what Kometa will read

### Requirement: Warn on missing connector dependencies

The system SHALL, during preview, warn (without blocking) when an enabled chart collection or overlay requires a service connector that is not configured (for example a `trakt` or `tautulli` chart with no corresponding connector section), naming the missing connector.

#### Scenario: Dependency warning shown

- **WHEN** a library enables a `tautulli` chart but no `tautulli` connector is configured
- **THEN** the preview warns that the `tautulli` connector is required, and the user can still proceed

## MODIFIED Requirements

### Requirement: Sync libraries and wire the metadata file

The system SHALL build the `libraries:` section from the user's selected managed libraries and SHALL add the generated `posterpilot.yml` as a `metadata_files` `file:` entry under each managed library. The `posterpilot.yml` file SHALL be written into the **same directory as `config.yml`**, and the `metadata_files` entry SHALL reference it as Kometa resolves it relative to its config directory (default the bare `posterpilot.yml`, with an optional relative-prefix override). Re-running the sync SHALL be idempotent and SHALL NOT duplicate the metadata entry; a previously-written entry from a different metadata location SHALL be migrated (removed and replaced with the co-located one). Deselecting a library SHALL remove PosterPilot's managed entries without disturbing user-authored entries.

#### Scenario: Metadata file co-located and wired

- **WHEN** a library is managed and a sync runs
- **THEN** `posterpilot.yml` is written next to `config.yml` and the library's `metadata_files` contains a single PosterPilot entry referencing it as Kometa sees it

#### Scenario: Stray prior entry migrated

- **WHEN** a prior sync left a `metadata_files` entry pointing at a different (non-co-located) path
- **THEN** the next sync's preview shows that entry being removed and the co-located entry ensured, with no duplicate remaining

### Requirement: Kometa management surface

The system SHALL present a dedicated Kometa manager page (not a Settings tab) where the user configures the config-file path and mode, manages connectors, per-library collections/overlays/operations/metadata/settings, global settings/webhooks, edits the raw file, previews changes, runs the sync, and views/restores backups. All of the page's UI text SHALL render in the active locale, falling back to English for any untranslated message.

#### Scenario: Manager page renders

- **WHEN** the user opens the Kometa manager page
- **THEN** the page shows the config path/mode header, the connector/library/global sections, the raw editor and backups, and preview/sync actions

#### Scenario: Localized manager

- **WHEN** the active locale is not English
- **THEN** the manager's labels, hints, and actions render in the active locale, falling back to English for untranslated messages

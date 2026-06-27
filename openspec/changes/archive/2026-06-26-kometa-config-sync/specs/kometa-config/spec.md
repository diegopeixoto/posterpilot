## ADDED Requirements

### Requirement: Locate and load the Kometa config file

The system SHALL manage a single Kometa `config.yml` whose location is supplied as a configurable filesystem path (environment variable `KOMETA_CONFIG_PATH` or a persisted setting). When no path is configured the feature SHALL be inactive and the UI SHALL present a setup prompt rather than an error. When a path is configured, the system SHALL read and parse the file while retaining its comments and formatting; when the file does not exist at a configured path, the system SHALL offer to scaffold a minimal valid config rather than failing.

#### Scenario: No config path configured

- **WHEN** the Kometa tab is opened and no config path is set
- **THEN** the system shows a setup prompt to configure the path and performs no read or write

#### Scenario: Existing config loaded

- **WHEN** a config path is set and a readable `config.yml` exists there
- **THEN** the system loads and parses it, preserving its comments and key order, and presents its current managed-section state

#### Scenario: Config file missing at configured path

- **WHEN** a config path is set but no file exists there
- **THEN** the system offers to scaffold a minimal valid `config.yml` and does not write until the user confirms

#### Scenario: Unparseable config file

- **WHEN** the file at the configured path is not valid YAML
- **THEN** the system surfaces a clear parse error, makes no modification, and does not overwrite the file

### Requirement: Management mode

The system SHALL support two management modes for the config file, selected by configuration and defaulting to `merge`:

- In `merge` mode the system SHALL update only the sections it manages and preserve all other content (per the Surgical ownership boundary requirement).
- In `own` mode the system SHALL regenerate the entire file from its own settings, dropping any top-level keys it does not manage. Even in `own` mode the system SHALL show a preview before writing and SHALL write atomically with a backup.

#### Scenario: Merge mode preserves unmanaged content

- **WHEN** the mode is `merge` and a sync runs against a config containing unmanaged keys
- **THEN** the system updates only its sections and leaves all other keys and comments in place

#### Scenario: Own mode regenerates and reports drops

- **WHEN** the mode is `own` and a sync runs against a config containing unmanaged top-level keys
- **THEN** the preview lists those keys as ones that will be removed, and on confirm the system writes a regenerated file (after creating a backup) that contains only PosterPilot-managed sections

### Requirement: Surgical ownership boundary

In `merge` mode the system SHALL modify only the sections and entries it manages and SHALL preserve every other top-level key, hand-written entry, comment, and the document's key order, aside from cosmetic whitespace normalization the YAML serializer may apply (e.g. collapsing consecutive blank lines). The system SHALL track which entries it owns so that a subsequent sync updates or removes only PosterPilot-managed entries and never deletes user-authored content.

#### Scenario: Unmanaged content preserved

- **WHEN** a sync writes the file and the existing config contains keys, entries, or comments PosterPilot does not manage
- **THEN** those keys, entries, comments, and their relative order are preserved in the written file (their values and associated comments are semantically unchanged, though the serializer may normalize incidental whitespace)

#### Scenario: Managed entry removed on deselection

- **WHEN** an item PosterPilot previously added is deselected and a sync runs
- **THEN** the system removes only that PosterPilot-managed entry and leaves all user-authored sibling entries intact

### Requirement: Sync Plex and TMDB connections

The system SHALL populate the `plex:` and `tmdb:` sections of the config from PosterPilot's stored Plex base URL and token and TMDB API credential. Because Kometa manages Plex only, the connection sync SHALL target the `plex:` section regardless of which media-server type is active in PosterPilot, drawing on the separately-stored Plex credentials. When Plex credentials are absent, the `plex:` sync SHALL be a no-op accompanied by a clear notice rather than writing empty values.

#### Scenario: Connections written

- **WHEN** a sync runs with Plex URL+token and a TMDB credential present
- **THEN** the system sets `plex.url`, `plex.token`, and `tmdb.apikey` to PosterPilot's stored values, preserving any other keys already under those sections

#### Scenario: Plex credentials absent

- **WHEN** a sync runs but no Plex URL or token is stored
- **THEN** the system leaves the `plex:` section untouched and reports that Plex credentials are required for Kometa

### Requirement: Sync libraries and wire the metadata file

The system SHALL build the `libraries:` section from the user's selected managed libraries (chosen from PosterPilot's included sections) and SHALL add the generated `posterpilot.yml` as a `metadata_files` `file:` entry under each managed library, using the path at which **Kometa** will see that file. Because PosterPilot's and Kometa's filesystem views may differ under separate container mounts, this Kometa-visible path SHALL be configurable; it MAY default from the Kometa assets directory but SHALL be overridable so the written `file:` value matches Kometa's own mount. Re-running the sync SHALL be idempotent — it SHALL NOT duplicate the metadata entry — and deselecting a library SHALL remove PosterPilot's managed entries for it without disturbing other entries the user added under that library.

#### Scenario: Library and metadata entry added

- **WHEN** a library is selected as managed and a sync runs
- **THEN** the system ensures a `libraries:` entry for it exists and adds a `metadata_files` entry of the form `- file: <kometa-visible-path>/posterpilot.yml`

#### Scenario: Re-sync is idempotent

- **WHEN** a sync runs again with no selection changes
- **THEN** the managed `metadata_files` entry is present exactly once and the file content for managed sections is unchanged

#### Scenario: Library deselected

- **WHEN** a previously managed library is deselected and a sync runs
- **THEN** the system removes PosterPilot's managed `metadata_files`/`collection_files` entries for that library while preserving any user-authored entries and the library block itself if the user has other content there

### Requirement: Manage default collection sets per library

The system SHALL let the user enable or disable Kometa default collection sets ("categories" such as genre, studio, country, decade, franchise) per managed library, chosen from a known catalog of Kometa default collection names. The system SHALL manage the matching `- default: <name>` entries in that library's `collection_files` and SHALL preserve any non-default or user-authored `collection_files` entries.

#### Scenario: Default sets enabled

- **WHEN** the user enables the `genre` and `studio` default sets for a managed library and syncs
- **THEN** the library's `collection_files` contains `- default: genre` and `- default: studio`

#### Scenario: Default set disabled

- **WHEN** the user disables a previously enabled default set and syncs
- **THEN** the system removes only that `- default: <name>` entry and leaves other default and custom `collection_files` entries in place

#### Scenario: Unknown default rejected

- **WHEN** a default-collection selection names a value not in the known catalog
- **THEN** the system rejects it and does not write an unrecognized `default:` entry

### Requirement: Manage bounded global settings, webhooks, and scheduling

The system SHALL manage only an explicitly-exposed, bounded set of global `settings:`, `webhooks:`, and run/schedule keys surfaced in the Kometa tab, and SHALL leave every other key under those sections untouched.

#### Scenario: Managed setting written, others preserved

- **WHEN** the user changes a managed global setting and syncs
- **THEN** the system updates only that managed key and preserves all other `settings:`/`webhooks:` keys and their comments

### Requirement: Preview changes before writing

The system SHALL produce a preview of the changes a sync would make to the config file and SHALL NOT write the file until the user confirms. Secret values (Plex token, TMDB credential) SHALL be redacted in the preview shown to the browser even though they are written in full to the on-disk file.

#### Scenario: Preview then confirm

- **WHEN** the user requests a sync
- **THEN** the system shows a diff of additions, modifications, and removals and writes the file only after the user confirms

#### Scenario: Preview cancelled

- **WHEN** the user reviews the preview and cancels
- **THEN** the system makes no change to the config file

#### Scenario: Secrets redacted in preview

- **WHEN** the preview includes the `plex.token` or `tmdb.apikey` values
- **THEN** those values are redacted in the diff returned to the browser while still being written verbatim to disk on confirm

### Requirement: Write atomically with backup

The system SHALL write the config file atomically (write to a temporary file then rename) and SHALL create a timestamped backup of the prior file before replacing it, so a failed or partial write cannot corrupt the user's existing config.

#### Scenario: Backup created on write

- **WHEN** a sync writes the config file
- **THEN** the prior file content is preserved as a timestamped backup alongside the config

#### Scenario: Original intact on failure

- **WHEN** the write fails partway
- **THEN** the original `config.yml` remains intact and unmodified

### Requirement: Persist sync selections

The system SHALL persist the user's sync selections — which libraries are managed, which default collection sets are enabled per library, which global settings are managed, and the optional Kometa-visible metadata path override — so they survive restarts and drive subsequent syncs without re-entry.

#### Scenario: Selections survive restart

- **WHEN** the user sets managed libraries and default sets, then the application restarts
- **THEN** the previously saved selections are restored and used as the basis for the next preview and sync

### Requirement: Kometa configuration tab

The system SHALL present a "Kometa" settings tab where the user configures the config-file path, selects managed libraries, picks default collection sets, toggles managed global settings, previews changes, and runs the sync. All of the tab's UI text SHALL render in the active locale, falling back to English for any untranslated message.

#### Scenario: Tab renders controls

- **WHEN** the user opens the Kometa settings tab
- **THEN** the tab shows the config-path control, the managed-library and default-set selectors, the managed-settings toggles, and preview/sync actions

#### Scenario: Localized tab

- **WHEN** the active locale is not English
- **THEN** the Kometa tab's labels, hints, and actions render in the active locale, falling back to English for untranslated messages

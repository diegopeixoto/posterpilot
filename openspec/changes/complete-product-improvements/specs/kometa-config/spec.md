## MODIFIED Requirements

### Requirement: Preview changes before writing

The system SHALL produce a preview of the exact changes a structured sync or scaffold would make to the config file and SHALL NOT write the file until the user explicitly confirms that preview. The preview SHALL include additions, modifications, removals, warnings, management mode, and a fingerprint of the source file. The server SHALL issue a single-use, expiring confirmation token bound to the source fingerprint and the complete proposed content; confirmation SHALL write only that content and SHALL be rejected if the file, inputs, mode, token, or proposed content changed after preview. Secret values (Plex token, TMDB credential, and connector secrets) SHALL be redacted in the preview shown to the browser and SHALL NOT be recoverable from the confirmation token, even though they are written in full to the on-disk file.

#### Scenario: Preview then confirm

- **WHEN** the user requests a sync and then explicitly confirms its unused preview while the source and inputs remain unchanged
- **THEN** the system writes exactly the additions, modifications, and removals shown in that preview

#### Scenario: Preview cancelled

- **WHEN** the user reviews the preview and cancels
- **THEN** the system makes no change to the config file

#### Scenario: Secrets redacted in preview

- **WHEN** the preview includes the `plex.token`, `tmdb.apikey`, or another managed connector secret
- **THEN** those values are redacted in the diff returned to the browser while still being written verbatim to disk on valid confirmation

#### Scenario: Config changes after preview

- **WHEN** the source file changes after a preview is issued and before it is confirmed
- **THEN** the system rejects the stale confirmation, writes nothing, and requires a fresh preview

#### Scenario: Inputs change after preview

- **WHEN** the user changes a managed selection, connector value, or management mode after a preview is issued
- **THEN** the prior confirmation token cannot authorize the changed content and the system requires a fresh preview

#### Scenario: Confirmation token is reused

- **WHEN** a client submits a confirmation token that has already been consumed or has expired
- **THEN** the system rejects it and performs no write

### Requirement: Edit the raw configuration file

The system SHALL provide a raw editor for the full `config.yml` that validates YAML, produces a diff against the current file, and writes through the same atomic backup-and-replace path as a structured sync. Requesting a raw save SHALL only create a server-issued, single-use preview bound to the complete raw content and current file fingerprint; a separate explicit confirmation SHALL be required before writing. A parse error SHALL block preview creation and be reported inline. A stale, expired, reused, or content-mismatched confirmation SHALL perform no write. After a confirmed raw save, structured views SHALL reflect the new file content.

#### Scenario: Raw edit saved

- **WHEN** the user requests a preview for valid raw YAML and explicitly confirms that unchanged preview while the source file remains unchanged
- **THEN** the system writes exactly the previewed content atomically with a backup, and the structured views re-render from the new content

#### Scenario: Raw edit rejected

- **WHEN** the user requests a preview for raw content that is not valid YAML
- **THEN** the system reports the parse error inline and does not issue a confirmation token or write the file

#### Scenario: Raw content changes after preview

- **WHEN** the client submits confirmation with raw content different from the content bound to the preview
- **THEN** the system rejects the confirmation and leaves the file unchanged

#### Scenario: Raw source changes after preview

- **WHEN** another process changes `config.yml` after a raw preview is issued
- **THEN** the system rejects confirmation against the stale source fingerprint and requires a fresh preview

### Requirement: List and restore backups

The system SHALL list the timestamped backups it has written for the config file and SHALL let the user restore one through preview and explicit confirmation. The restore preview SHALL identify the selected backup, show a redacted diff against the current file, and issue a single-use token bound to both files' fingerprints. A confirmed restore SHALL itself back up the current file before replacing it atomically. If either fingerprint changes after preview, the restore SHALL be rejected.

#### Scenario: Restore a backup

- **WHEN** the user previews a listed backup and explicitly confirms the unchanged restore plan
- **THEN** the system backs up the current file, writes the chosen backup's exact content over it atomically, and the restored content is what Kometa will read

#### Scenario: Restore is cancelled

- **WHEN** the user cancels a backup restore preview
- **THEN** the current config file and the selected backup remain unchanged

#### Scenario: Restore preview becomes stale

- **WHEN** the current file or selected backup changes after the restore preview is issued
- **THEN** the system rejects confirmation and requires the user to preview the restore again

## ADDED Requirements

### Requirement: Preserve reversible PosterPilot-managed Kometa metadata

Before a confirmed operation changes a PosterPilot-managed item entry in `posterpilot.yml`, the system SHALL capture the exact prior managed entry, or its absence, in the artwork revision ledger. Each changed item SHALL receive an independent Kometa destination outcome and verification result. The system SHALL support previewed, confirmed undo that restores the prior managed entry or removes a newly introduced entry while preserving all user-authored entries, comments, and unrelated PosterPilot-managed items.

#### Scenario: Existing managed entry is updated

- **WHEN** a confirmed Kometa export changes an existing PosterPilot-managed item entry
- **THEN** the system records its exact prior and resulting values as a Kometa revision and verifies the persisted YAML

#### Scenario: New managed entry is undone

- **WHEN** the user confirms undo for a revision that introduced an item with no prior managed entry
- **THEN** the system removes only that PosterPilot-managed item entry and leaves sibling entries unchanged

#### Scenario: Bulk export partially fails verification

- **WHEN** a bulk Kometa export writes multiple item entries but one resulting entry cannot be verified
- **THEN** the system records independent per-item outcomes and offers retry or undo for the affected revisions without representing the whole export as unqualified success

### Requirement: Bind Kometa metadata confirmation to an exact plan

Every single-item or bulk mutation of `posterpilot.yml` SHALL require a server-generated preview that lists each affected item, slot, prior value, proposed value, and removal. Its single-use confirmation token SHALL be bound to the complete plan, selected destination, current metadata-file fingerprint, and pending selections. The system SHALL perform no metadata write when confirmation is stale, altered, expired, or reused.

#### Scenario: Exact metadata plan is confirmed

- **WHEN** the user confirms an unused metadata preview and its file fingerprint and pending selections are unchanged
- **THEN** the system writes exactly the item and slot mutations listed in the preview and no others

#### Scenario: Pending selection changes before confirmation

- **WHEN** an item's pending artwork changes after the metadata preview is issued
- **THEN** the system rejects the old confirmation and requires a new preview reflecting the changed selection

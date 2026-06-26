## Context

`kometa-config-sync` shipped a surgical merge engine (`src/lib/server/kometa/config.ts`, comment-preserving via the `yaml` Document API), atomic backup-and-replace I/O (`config-io.ts`), a sync orchestration layer (`sync.ts`), preview/sync endpoints, and a Settings tab managing connections + library collection-defaults. This change keeps that engine and grows it into a complete manager on a dedicated page.

A real user config drove the requirements: top-level `libraries`, `collections`, `settings`, `plex`, `tmdb`, `tautulli`, `trakt`; per-library `collection_files` (incl. `imdb`/`trakt`/`tautulli` charts), `overlay_files` (incl. `mediastinger`), `remove_overlays`, and two `metadata_files` entries (the user's `config/posterpilot.yml` plus a stray `/kometa/posterpilot.yml` PosterPilot added under the old separate-metadata-path model).

Design canon (`.impeccable.md`): sleek/cinematic, dark-only, single violet accent, **artwork is the hero; chrome recedes**, and explicitly *not* an "*arr config wall." That tension — a config-dense tool that must still feel cinematic — is what the spotlight resolves.

## Goals / Non-Goals

**Goals:**
- A dedicated `/kometa` page that manages the whole `config.yml`: structured forms for all connectors, per-library collections/overlays/operations/metadata/settings, global settings/webhooks — plus a raw editor for anything unformed.
- A cinematic spotlight hero so the page carries the brand instead of reading as a config dashboard.
- Co-locate `posterpilot.yml` with `config.yml`; remove `KOMETA_METADATA_PATH`.
- Keep every existing safety property: surgical merge (default) / own (opt-in), preview-diff before write, secret redaction, atomic write + timestamped backup, single-flight lock, anchor/alias skips. Add backup restore + consistency validation.
- Keep all new pure logic `$env`-free and unit-tested.

**Non-Goals:**
- Hand-modeling a bespoke form for every Kometa option — the raw editor is the backstop for the long tail.
- Making `own` the default (stays opt-in).
- Running Kometa, scheduling it, or editing collection/overlay file *contents* beyond `default:` references.
- A new heavy code-editor dependency — a validated textarea (with monospace + line context) is enough for v1.

## Decisions

### D1 — Dedicated page with a spotlight hero (move off the Settings tab)
New route `src/routes/kometa/+page.svelte` + `+page.server.ts`, registered in the main nav. The Settings → "Kometa config" tab is removed; Settings shows a one-line pointer. The page is organized into sub-sections: **Connections · Libraries · Settings & Webhooks · Raw · Backups**, beneath a header carrying the config path, mode toggle, status, and Preview/Sync actions.

**Spotlight:** a backdrop hero banner at the top — reusing the library spotlight pattern (a recently-changed item's backdrop) — with the manager title and live status (config path, mode, exists/parse state, last sync time, managed-library count) overlaid. Honors `prefers-reduced-motion`. This is the "browsing/hero" moment (principle 4); the forms below stay dense and information-honest. Rationale: a pure config page would violate "artwork is the hero" — the spotlight buys cinematic identity cheaply and reuses existing imagery.

- **Alternative — keep it in Settings:** rejected by the user; a complete manager outgrows a settings tab and deserves nav presence.

### D2 — Engine generalization (section-agnostic plan + snapshot)
Today's `ConfigPlan` ({creds, metadataFile, libraries{defaults}, settings}) becomes section-agnostic:
- `connections: Record<string, Record<string,string>>` — connector section → key/value (e.g. `tautulli: {url, apikey}`).
- `libraries: { name, collections[], overlays[], operations: Record<string,string|bool>, settingsOverrides: Record<string,string>, metadata: boolean }[]`.
- `globals: { settings: Record<string,string>, webhooks: Record<string,string> }`.

`applyPlan`/`KometaSnapshot` extend the existing structural-identity + last-applied-snapshot pattern per section: managed connector keys, per-library managed overlay/operation/collection defaults and setting-override keys. Removal-on-deselect already works this way for collections; the same shape covers the rest. Anchors/aliases in any managed section → skip + warn (unchanged).

- **Alternative — a second engine for the new sections:** rejected; one generalized engine keeps preservation guarantees uniform.

### D3 — Raw editor path
A `raw` sub-section: load `config.yml` text, edit, then **Validate → Diff → Save**. Save reuses `config-io` (atomic + backup + lock) and reports YAML parse errors inline. After a raw save, structured views re-read the file (they always render from disk), and the managed snapshot is **re-baselined** from the file so structured + raw never fight. Secrets are shown in the raw editor only when the user explicitly reveals (it's their file on their disk), but the **diff** still redacts.

### D4 — Catalogs (pure data, client-safe via load)
- `connectors.ts` — section → fields (`{name, key, type: 'text'|'secret'|'url'|'bool', placeholder}`), covering plex/tmdb/tautulli/trakt/mdblist/omdb/github/radarr/sonarr/notifiarr/gotify/ntfy/anidb/mal.
- `overlay-defaults.ts` — grouped overlay default names (mediastinger, resolution, audio_codec, ribbon, network, ratings, …).
- `operations.ts` — known per-library operations and their value types.
- Existing `defaults-catalog.ts` (collections) stays. All passed to the client via the page `load` (no `$lib/server` import client-side).

### D5 — Co-located metadata path (remove `KOMETA_METADATA_PATH`)
`posterpilot.yml` is written to `dirname(kometaConfigPath)`. The `metadata_files` `file:` value defaults to the basename `posterpilot.yml` (Kometa resolves it relative to its config dir), with an optional relative-prefix override for layouts like `config/posterpilot.yml`. The poster apply/export writes `posterpilot.yml` to that same directory whenever config sync is configured, so there is exactly one file and the wiring always matches. `kometaMetadataPath` is dropped from the config layer; `kometaAssetsDir` remains for the standalone (no-config-sync) export.

- **Migration of the stray entry:** on the first sync under the new model, the preview shows the old `/kometa/posterpilot.yml` entry being removed and the co-located one being ensured.

### D6 — Consistency validation
A pure checker run during preview: if a library enables a chart collection or overlay that requires a connector (`trakt`, `tautulli`, `mdblist`, `mal`, …) and that connector section is absent/empty, emit a non-blocking warning listing the missing connector. Surfaced in the preview alongside anchor warnings.

### D7 — Backups panel + restore
`config-io` already writes `config.yml.posterpilot-bak-<stamp>`. Add `listBackups(path)` and `restoreBackup(path, name)` (restore = atomic write of the backup content over current, itself backed up first). A Backups sub-section lists them with timestamps and a restore action (with confirm).

## Risks / Trade-offs

- **Surface size.** The structured forms are large. → Drive them generically from catalogs (one form component per field-type), not bespoke markup per connector; lean on the raw editor for the tail.
- **Config-wall aesthetic risk.** A dense form page fights the brand. → Spotlight hero + image-forward header + restrained surfaces (principle 4); forms grouped and collapsible, secrets masked.
- **Raw edit vs structured snapshot drift.** → Structured views always read disk; snapshot re-baselined after raw save; preview-diff makes every write explicit.
- **Co-location path correctness across mounts.** → Default to a Kometa-relative basename and show the resolved on-disk path + the `file:` value the entry will use in the preview, so a mismatch is visible before write (carrying forward the resolved-path display already added).
- **Secrets on disk (unchanged truth).** Kometa needs plaintext tokens; written into config.yml + backups. → Masked in UI, redacted in diffs, documented; backups live in the same already-sensitive dir.
- **Removing `KOMETA_METADATA_PATH`** is a behavior change for anyone who set it. → It was new and unreleased in a stable tag; migration is automatic and shown in preview. Documented.

## Migration Plan

- Additive + feature-gated (off without a config path). No DB migration (settings KV; selection blobs via the `cachedLibraries`-style accessors).
- Ship: generalized engine + catalogs → `/kometa` page + nav + spotlight → raw editor + backups → remove Settings tab + `kometaMetadataPath` → i18n + docs.
- Rollback: unset the config path to deactivate; backups (+ restore panel) recover any prior file.

## Open Questions

- Backup retention default (keep last N; surface a "clear old backups" action?).
- Connection-test coverage — which connectors get a live test button beyond plex/tmdb (tautulli/trakt/radarr/sonarr are testable; others may not be worth it for v1).
- Spotlight image source when the library has no recently-changed item yet (fallback: a static cinematic backdrop or the app's own artwork).

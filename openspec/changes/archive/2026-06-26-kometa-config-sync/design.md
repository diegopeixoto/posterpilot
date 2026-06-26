## Context

PosterPilot already writes `posterpilot.yml` (a Kometa *metadata* file) via `src/lib/server/kometa/yaml.ts`, using the `yaml` package's `parse`/`stringify`. That file is fully owned by PosterPilot, so a lossy parse→object→stringify round-trip is fine there.

This change is different: PosterPilot must edit Kometa's **own** `config.yml`, a file the user authors and tunes by hand. The decisions below are driven by two hard constraints that the existing `yaml.ts` does not face:

1. **Preserve everything we don't own** — comments, key order, and hand-written entries must survive a write untouched.
2. **Know what we own** — a sync must update or remove only PosterPilot-managed entries across runs, even as the user's selections change.

Relevant current state:
- Config layer `src/lib/server/config/index.ts`: `ConfigKey` union, `ENV_MAP`, `WRITABLE_KEYS`, defaults; env-overrides-DB-overrides-default precedence; JSON-valued settings already exist (`includedSections`).
- Settings UI `src/routes/settings/+page.svelte`: 5 tabs, save via `POST /api/settings`, dry-run via `POST /api/settings/test`, `invalidateAll()` reload.
- `yaml` package is already a dependency. Kometa is **Plex-only**.

## Goals / Non-Goals

**Goals:**
- Surgically read → merge managed sections → write Kometa `config.yml`, preserving all unmanaged content and comments.
- Sync `plex:`/`tmdb:` from stored creds; build `libraries:`; wire `posterpilot.yml` into `metadata_files`; manage `default:` collection sets per library; manage a bounded set of `settings:`/`webhooks:`/schedule keys.
- Preview (diff) before every write; atomic write with timestamped backup; idempotent re-sync; safe removal on deselection.
- New "Kometa" settings tab, fully localized; feature inert until a config path is set.
- Keep all new pure logic `$env`-free and unit-tested.

**Non-Goals:**
- Making `own` mode the default — full ownership is opt-in; `merge` (surgical) is the default and the recommended mode.
- Supporting Jellyfin/Emby in the config (Kometa is Plex-only).
- Editing config that relies on YAML anchors/aliases *inside* managed sections (detect + warn, don't attempt).
- Running Kometa, scheduling Kometa runs from PosterPilot, or managing Kometa collection/overlay file *contents* beyond `default:` references.
- Syncing provider keys beyond TMDB (Fanart/OMDb/etc.) — possible future, out of scope here.

## Decisions

### D1 — Comment-preserving edits via the `yaml` Document API
Use `parseDocument(raw)` (eemeli/`yaml`) to get a mutable `Document` and edit nodes in place with `doc.setIn([...path], value)`, `doc.deleteIn(...)`, and `YAMLSeq`/`YAMLMap` node manipulation, then `doc.toString()` to serialize. This retains comments, key order, and scalar styles for everything we don't touch.

**Fidelity caveat (verified):** the Document API does **not** guarantee byte-for-byte whitespace fidelity. `toString()` re-serializes the whole document; blank lines survive only as a `spaceBefore` boolean (so consecutive blanks collapse to one) and trailing-comment attachment is "not completely stable" per the library's own docs. This is acceptable here — we promise *semantic* preservation of unmanaged content (values, comments, order), not incidental whitespace — and the specs are worded accordingly. If true byte fidelity ever becomes a hard requirement, the escalation path is the CST API (`parseDocument(raw, { keepSourceTokens: true })` and mutate `srcToken`s), which we explicitly defer.

- **Alternative — `parse()`→plain object→`stringify()`** (what `yaml.ts` does): drops all comments and reorders keys. Rejected: violates the core preservation goal.
- **Alternative — CST API for byte fidelity**: maximal preservation but far more code to do targeted edits. Deferred unless byte fidelity is required.
- **Alternative — string/regex splicing**: brittle against indentation, quoting, and nested structures. Rejected.
- **Alternative — new dependency (e.g. a "yawn"-style patcher)**: unnecessary; `yaml` already supports this and is already vendored.

### D2 — Ownership model: persisted selection snapshot + structural identity
PosterPilot's source of truth for "what should be managed" is its DB selections. To remove entries safely when the user deselects, persist a **last-applied snapshot** of what PosterPilot wrote.

- A sync computes a **plan** from current selections, diffs it against the snapshot to get adds/removes, applies them to the `Document`, then stores the new snapshot.
- **Structural identity** is the backstop for idempotency and for recognizing our entries regardless of snapshot:
  - managed `metadata_files` entry = a `file:` entry whose path equals the **Kometa-visible** `posterpilot.yml` path (see D8) — not PosterPilot's own `kometaAssetsDir`, which can differ under separate mounts.
  - managed `collection_files` default = a `- default: <name>` entry whose `<name>` is in the known catalog **and** in the user's enabled set for that library.
- We never touch list entries that don't match these identities — that's how user-authored siblings survive.

- **Alternative — sentinel comments** (`# posterpilot:managed`) on each managed node: the `yaml` API's comment attachment on sequence items is awkward and easily lost by user edits. Rejected as the primary mechanism (snapshot is more robust); structural identity already disambiguates.
- **Alternative — begin/end managed-region markers**: forces our content into a contiguous block, fighting Kometa's per-library structure. Rejected.

### D3 — Module layout (mirror existing `kometa/` conventions)
- `src/lib/server/kometa/config.ts` — pure transforms: `loadDoc(raw): Document`, `buildPlan(selections, creds, paths): ConfigPlan`, `applyPlan(doc, plan, snapshot): { doc, diff, nextSnapshot }`, `serialize(doc): string`, `scaffoldDoc(plan): Document`, `redactSecrets(diff)`. No `$env`, no fs — unit-tested like `yaml.test.ts`.
- `src/lib/server/kometa/defaults-catalog.ts` — the frozen catalog of Kometa default collection names (genre, studio, country, decade, franchise, network, resolution, content_rating_*, …), grouped for the UI. Pure data + a membership guard.
- `src/lib/server/kometa/config-io.ts` (impure) — `readConfig(path)`, `writeConfigAtomic(path, text)` (temp-write + `rename`, backup-before-replace), mirroring how `yaml.ts` isolates `writeKometaYaml`. Kept thin so tests stay on the pure layer.

### D4 — Config & persisted selections (two distinct storage patterns)
`src/lib/server/config/index.ts` has two precedents and we use the right one for each datum:

1. **`AppConfig`/`ENV_MAP`/`WRITABLE_KEYS`** — the env-overridable, user-editable string settings. `ENV_MAP` is typed `Record<ConfigKey, string>` and is **exhaustive**, so every `AppConfig` field is forced to have an env var and a `resolveConfig` line. Only genuinely env-configurable scalars belong here. We add exactly one: `kometaConfigPath` → env `KOMETA_CONFIG_PATH`, writable, default `''` (empty = feature off). (Optionally also `kometaMetadataPath` from D8 if we make it env-settable.)
2. **Dedicated KV accessors** — the existing `cachedLibraries` pattern (`CACHED_LIBRARIES_KEY` + `getCachedLibraries`/`setCachedLibraries`) stores an internal JSON blob in the `settings` table **without** touching `AppConfig`/`ENV_MAP`/`WRITABLE_KEYS`. This is the correct home for our internal, non-env, non-string selection state: `kometaManagedLibraries` (string[]), `kometaDefaultCollections` (**map** library→string[] — note this is *not* the `includedSections` `string[]` shape), `kometaManagedSettings`, and `kometaLastApplied` (the D2 snapshot). Add `get/set` accessors mirroring `cachedLibraries`.

Both patterns ride the existing `settings` KV table — **no Drizzle migration** required. (The earlier "same shape as `includedSections`" framing was wrong: routing these through `saveSettings`/`WRITABLE_KEYS` would force spurious `ENV_MAP` entries and can't represent the map.)

### D5 — API surface (mirror `/api/settings` + `/api/settings/test`)
- Settings `+page.server.ts` load extends with Kometa-tab data: configured path, parsed managed-state, available libraries (from included sections), the defaults catalog, and whether the file exists/parses.
- `POST /api/kometa/config/preview` — body = selections; returns a **redacted** structured diff (+ optional rendered YAML). No write.
- `POST /api/kometa/config/sync` — body = confirmed selections; performs atomic write + backup, persists selections and the new snapshot, logs an event. Reuses `logEvent('info','system',…)`.
- The config path is saved through the existing `/api/settings` endpoint (it's just another `ConfigKey` once added to `WRITABLE_KEYS`). **Caveat:** the settings page's client `save()` builds a hardcoded payload of server/provider/advanced fields, so it won't include `kometaConfigPath` automatically — extend that payload (or give the Kometa tab its own save) so the field actually persists.

### D9 — Two modes: `merge` (default) vs `own`
A `kometaConfigMode` config key (`merge` | `own`, default `merge`, env `KOMETA_CONFIG_MODE`, writable) selects behavior. `merge` is everything above (surgical, snapshot-driven). `own` regenerates the whole file from the plan each sync via `buildOwnedDoc(plan)` (a fresh Document, no existing content carried over) and reports, in the preview, the existing top-level keys that would be dropped (`topLevelKeys(old) − topLevelKeys(owned)`). Both modes share the same preview-before-write and atomic-backup path, so `own` is safe (the prior file is always backed up). The whole feature stays optional/off until a config path is set, independent of mode.

- **Alternative — only surgical merge**: simplest, but some users want PosterPilot to be the single source of truth for `config.yml`. `own` serves them without forcing the trade-off on everyone.

### D8 — Kometa-visible metadata path (mount-aware)
The `file:` value written into `config.yml` must be the path **Kometa** sees, which can differ from PosterPilot's `kometaAssetsDir` when the two run in separate containers with different mounts (e.g. PosterPilot writes `/data/kometa`, Kometa reads `/config/assets`). So the path used for the metadata wiring (and for D2 structural identity) is a **configurable Kometa-visible base path**, defaulting to `kometaAssetsDir` but overridable in the Kometa tab. The default keeps the common single-mount case zero-config; the override covers split mounts. Document the expectation clearly.

### D6 — Atomic write + backup
Before replacing: copy current file to `config.yml.posterpilot-bak-<UTCstamp>` in the same directory. Write new content to `config.yml.tmp-<rand>`, then `rename()` over the target (atomic on same filesystem). On any error, the original is untouched. Timestamp comes from the request layer (pure layer takes it as input, keeping it deterministic/testable — consistent with the repo's `Date.now()`-free test posture).

### D7 — Preview/diff & secrets
The diff is computed by applying the plan to a clone of the loaded `Document` and comparing managed paths (add/modify/remove with before/after). `redactSecrets` masks `plex.token` and `tmdb.apikey` in the browser-facing diff; the on-disk write keeps full values (Kometa requires plaintext). This satisfies the existing `configuration` "Handle secrets safely — never return full value to the client" requirement while still doing the disk write Kometa needs.

## Risks / Trade-offs

- **Comment preservation has edge cases on deep edits.** → Keep edits shallow and path-targeted; ship round-trip unit tests over representative real-world configs (with comments, blank lines, quoted scalars) asserting unmanaged content is *semantically* unchanged (values/comments/order intact; incidental whitespace may normalize — see D1).
- **Mount mismatch between PosterPilot and Kometa.** → The metadata `file:` path is a configurable Kometa-visible base (D8), defaulting to `kometaAssetsDir`; if it's wrong, Kometa silently ignores a non-existent metadata file. Surface the resolved path in the preview so the user can catch a mismatch before confirming.
- **User hand-edits a managed key between syncs.** → Preview-before-write always shows the overwrite; we own those keys by design, and the diff makes the change explicit before confirm.
- **Secrets land in the on-disk config and its backups.** → This is inherent to how Kometa consumes credentials; backups sit in the same already-sensitive directory; never logged; redacted in UI. Documented in the tab and docs.
- **Path safety.** → Only ever read/write the single configured file and its sibling backup/temp; validate the path is set and absolute-ish; never derive paths from request input.
- **YAML anchors/aliases within managed sections.** → Detect on load; if a managed section uses them, surface a warning and skip that section rather than risk corrupting references.
- **Concurrent writes** (a sync while another runs). → Single-flight the write path (in-process lock) so two syncs can't interleave on the same file.
- **Snapshot/disk drift** (user deletes our entries by hand). → Structural identity means we simply re-add on next sync; removals only target entries that still match our identity, so we never delete unrelated content.

## Migration Plan

- Purely additive and feature-gated: with `kometaConfigPath` empty the tab shows a setup prompt and nothing reads/writes the file. No schema migration (settings KV).
- Deploy: ship code + new i18n keys + docs; users opt in by setting `KOMETA_CONFIG_PATH` (or the UI field) and mounting Kometa's config dir (see `deployment` delta).
- Rollback: unset the path to deactivate; every write left a timestamped backup for manual restore.

## Open Questions

- Backup retention — keep all timestamped backups, or prune to the last N? (Lean: keep last N, default ~5.)
- Recommended default container path to document (e.g. `/config/config.yml`)?
- Which specific `settings:`/`webhooks:`/schedule keys to expose first (start minimal — e.g. `asset_directory` awareness, a webhook URL — and grow)?
- Should scaffold-on-missing also seed a sensible `settings:` block, or only `plex`/`tmdb`/`libraries`?

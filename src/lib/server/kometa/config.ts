/**
 * Surgical merge engine for Kometa's own `config.yml`.
 *
 * PosterPilot owns a few sections (plex/tmdb connections, the managed libraries'
 * `metadata_files`/`collection_files` entries, and a bounded set of global
 * settings) and must leave everything else — including the user's hand-written
 * keys and comments — intact. We use the `yaml` package's Document API
 * (`parseDocument` → mutate nodes → `toString()`), which preserves comments,
 * key order and scalar styles. It does NOT preserve incidental whitespace
 * byte-for-byte (blank lines can collapse), which is acceptable: we promise
 * *semantic* preservation of unmanaged content.
 *
 * Everything here is PURE (no fs, no `$env`) so it can be unit-tested in
 * isolation; the filesystem read/write lives in `config-io.ts`.
 */

import { Document, isAlias, isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import { knownDefaults } from './defaults-catalog';
import { CONNECTOR_DEPENDENCIES, SECRET_PATHS } from './connectors';

/** Plex/TMDB credentials PosterPilot writes into the connection sections. */
export interface KometaCreds {
	plexUrl: string | null;
	plexToken: string | null;
	tmdbKey: string | null;
}

/** One managed library and the default sets to enable for it. */
export interface PlanLibrary {
	/** Library name as it appears as the `libraries:` key (the Plex library title). */
	name: string;
	/** Default collection names to ensure as `- default: <name>` entries. */
	defaults: string[];
	/** Whether to wire the `posterpilot.yml` `metadata_files` entry. */
	metadata: boolean;
	/** Default overlay names to ensure as `- default: <name>` under `overlay_files`. */
	overlays?: string[];
	/** Per-library `operations` keys to set (key → scalar string value). */
	operations?: Record<string, string>;
	/** Per-library `settings` overrides to set (key → scalar string value). */
	settingsOverrides?: Record<string, string>;
}

/** A bounded global setting/webhook value to manage. */
export interface ManagedSetting {
	section: 'settings' | 'webhooks';
	key: string;
	value: string;
}

/** What PosterPilot owns within one managed library, for safe removal next sync. */
export interface ManagedLib {
	metadata: boolean;
	defaults: string[];
	overlays?: string[];
	operations?: string[];
	settingsKeys?: string[];
}

/** The fully-resolved desired managed state. */
export interface ConfigPlan {
	creds: KometaCreds;
	/** Kometa-visible path to `posterpilot.yml` (the `metadata_files` `file:` value). */
	metadataFile: string;
	libraries: PlanLibrary[];
	settings: ManagedSetting[];
	/**
	 * Generic service connectors beyond plex/tmdb (which come via `creds`):
	 * section → key/value, e.g. `{ tautulli: { url, apikey }, trakt: { … } }`.
	 * Empty-string values mean "unmanage" (remove if previously set).
	 */
	connections?: Record<string, Record<string, string>>;
	/**
	 * Per connector section, keys to carry forward untouched (not set, not removed) —
	 * blank secrets the user left alone. Without this, a resync would drop a secret
	 * the user already saved (e.g. tautulli.apikey, radarr.token).
	 */
	connectionKeep?: Record<string, string[]>;
}

/** What PosterPilot last wrote, used to compute safe removals on the next sync. */
export interface KometaSnapshot {
	metadataPath: string;
	libraries: Record<string, ManagedLib>;
	managedSettingKeys: string[];
	/** Managed key names per connector section (for removal on unmanage). */
	connections?: Record<string, string[]>;
}

/** A single change a sync would make (for the preview diff). */
export interface ChangeEntry {
	op: 'add' | 'modify' | 'remove';
	path: string;
	before?: string | null;
	after?: string | null;
}

export interface ApplyResult {
	doc: Document;
	changes: ChangeEntry[];
	nextSnapshot: KometaSnapshot;
	/** Sections skipped because they use YAML anchors/aliases. */
	warnings: string[];
}

/** Parse raw YAML into a mutable, comment-preserving Document. */
export function loadDoc(raw: string): Document {
	return parseDocument(raw);
}

/** Serialize a Document back to a YAML string. */
export function serialize(doc: Document): string {
	return doc.toString();
}

/** Assemble a ConfigPlan from resolved inputs (filters defaults to known names). */
export function buildPlan(input: {
	creds: KometaCreds;
	metadataFile: string;
	libraries: {
		name: string;
		defaults: string[];
		metadata?: boolean;
		overlays?: string[];
		operations?: Record<string, string>;
		settingsOverrides?: Record<string, string>;
	}[];
	settings?: ManagedSetting[];
	connections?: Record<string, Record<string, string>>;
	connectionKeep?: Record<string, string[]>;
}): ConfigPlan {
	return {
		creds: input.creds,
		metadataFile: input.metadataFile,
		libraries: input.libraries.map((l) => ({
			name: l.name,
			defaults: dedupe(knownDefaults(l.defaults)),
			metadata: l.metadata ?? true,
			overlays: l.overlays ? dedupe(l.overlays) : undefined,
			operations: l.operations,
			settingsOverrides: l.settingsOverrides
		})),
		settings: input.settings ?? [],
		connections: input.connections,
		connectionKeep: input.connectionKeep
	};
}

function dedupe(xs: string[]): string[] {
	return [...new Set(xs)];
}

/** Recursively detect a YAML anchor or alias anywhere in a node. */
function hasAliasOrAnchor(node: unknown): boolean {
	if (isAlias(node)) return true;
	if (isScalar(node)) return Boolean(node.anchor);
	if (isMap(node)) {
		if (node.anchor) return true;
		return node.items.some((p) => hasAliasOrAnchor(p.key) || hasAliasOrAnchor(p.value));
	}
	if (isSeq(node)) {
		if (node.anchor) return true;
		return node.items.some((i) => hasAliasOrAnchor(i));
	}
	return false;
}

/** Read a scalar value at a path as a primitive (or undefined). */
function scalarAt(doc: Document, path: (string | number)[]): unknown {
	return doc.getIn(path);
}

/** Get a node at a path, or undefined. */
function nodeAt(doc: Document, path: (string | number)[]): unknown {
	return doc.getIn(path, true);
}

/** Set a scalar, recording an add/modify change only when the value actually changes. */
function setScalar(
	doc: Document,
	path: (string | number)[],
	value: string,
	changes: ChangeEntry[]
): void {
	const before = scalarAt(doc, path);
	if (before === value) return;
	doc.setIn(path, value);
	changes.push({
		op: before === undefined ? 'add' : 'modify',
		path: path.join('.'),
		before: before === undefined ? null : String(before),
		after: value
	});
}

/** Find the index of a seq item that is a map with `map.get(key) === value`. */
function findMapItem(seq: YAMLSeq, key: string, value: string): number {
	return seq.items.findIndex((it) => isMap(it) && it.get(key) === value);
}

/** Ensure a YAMLSeq exists at the path, creating one if absent or wrong-typed. */
function ensureSeq(doc: Document, path: (string | number)[]): YAMLSeq {
	const existing = nodeAt(doc, path);
	if (isSeq(existing)) return existing;
	const seq = new YAMLSeq();
	doc.setIn(path, seq);
	return seq;
}

/**
 * Apply the plan to the Document, preserving unmanaged content. Returns the
 * mutated doc, the list of changes (the preview diff), the next snapshot, and any
 * warnings (sections skipped due to anchors/aliases).
 */
export function applyPlan(
	doc: Document,
	plan: ConfigPlan,
	snapshot: KometaSnapshot | null
): ApplyResult {
	const changes: ChangeEntry[] = [];
	const warnings: string[] = [];

	// ── Connections (plex/tmdb) ────────────────────────────────────────────────
	const plexNode = nodeAt(doc, ['plex']);
	if (plexNode !== undefined && hasAliasOrAnchor(plexNode)) {
		warnings.push('plex');
	} else if (plan.creds.plexUrl && plan.creds.plexToken) {
		setScalar(doc, ['plex', 'url'], plan.creds.plexUrl, changes);
		setScalar(doc, ['plex', 'token'], plan.creds.plexToken, changes);
	}

	const tmdbNode = nodeAt(doc, ['tmdb']);
	if (tmdbNode !== undefined && hasAliasOrAnchor(tmdbNode)) {
		warnings.push('tmdb');
	} else if (plan.creds.tmdbKey) {
		setScalar(doc, ['tmdb', 'apikey'], plan.creds.tmdbKey, changes);
	}

	// ── Service connectors (tautulli, trakt, radarr, …; plex/tmdb come via creds) ─
	const managedConn: Record<string, string[]> = {};
	const prevConn = snapshot?.connections ?? {};
	for (const [section, values] of Object.entries(plan.connections ?? {})) {
		const keep = new Set(plan.connectionKeep?.[section] ?? []);
		managedConn[section] = applyManagedMap(
			doc,
			[section],
			values,
			prevConn[section] ?? [],
			changes,
			warnings,
			section,
			keep
		);
	}
	// Connector sections dropped entirely from the plan: remove their managed keys.
	for (const [section, prevKeys] of Object.entries(prevConn)) {
		if (plan.connections && section in plan.connections) continue;
		applyManagedMap(doc, [section], {}, prevKeys, changes, warnings, section);
	}

	// ── Libraries ──────────────────────────────────────────────────────────────
	const planByName = new Map(plan.libraries.map((l) => [l.name, l]));
	const prevLibs = snapshot?.libraries ?? {};

	// Remove our entries from libraries that were managed before but no longer are.
	for (const [name, prev] of Object.entries(prevLibs)) {
		if (planByName.has(name)) continue;
		const libNode = nodeAt(doc, ['libraries', name]);
		if (!isMap(libNode)) continue;
		if (hasAliasOrAnchor(libNode)) {
			warnings.push(`libraries.${name}`);
			continue;
		}
		if (prev.metadata && snapshot) {
			removeMetadataEntry(doc, name, snapshot.metadataPath, changes);
		}
		removeDefaults(doc, name, 'collection_files', prev.defaults, changes);
		removeDefaults(doc, name, 'overlay_files', prev.overlays ?? [], changes);
		applyManagedMap(
			doc,
			['libraries', name, 'operations'],
			{},
			prev.operations ?? [],
			changes,
			warnings,
			`libraries.${name}.operations`
		);
		applyManagedMap(
			doc,
			['libraries', name, 'settings'],
			{},
			prev.settingsKeys ?? [],
			changes,
			warnings,
			`libraries.${name}.settings`
		);
	}

	// Add/reconcile managed libraries. Track what we actually own (added or were
	// already managing) so the snapshot never claims a user's pre-existing entry.
	const managedByLib: Record<string, ManagedLib> = {};
	for (const lib of plan.libraries) {
		const libPath = ['libraries', lib.name];
		const existing = nodeAt(doc, libPath);
		if (existing !== undefined && existing !== null && hasAliasOrAnchor(existing)) {
			warnings.push(`libraries.${lib.name}`);
			// Carry forward the prior snapshot so we don't lose track of what we own.
			managedByLib[lib.name] = prevLibs[lib.name] ?? { metadata: false, defaults: [] };
			continue;
		}
		// Materialize an empty `Name:` (null) or missing library as a map we can edit.
		if (existing === undefined || existing === null) {
			doc.setIn(libPath, new YAMLMap());
			changes.push({ op: 'add', path: `libraries.${lib.name}`, after: '(library)' });
		}

		if (lib.metadata) ensureMetadataEntry(doc, lib.name, plan.metadataFile, snapshot, changes);

		const prev = prevLibs[lib.name];
		const ownedDefaults = reconcileDefaults(
			doc,
			lib.name,
			'collection_files',
			lib.defaults,
			prev?.defaults ?? [],
			changes
		);
		const ownedOverlays = reconcileDefaults(
			doc,
			lib.name,
			'overlay_files',
			lib.overlays ?? [],
			prev?.overlays ?? [],
			changes
		);
		const ownedOps = applyManagedMap(
			doc,
			['libraries', lib.name, 'operations'],
			lib.operations ?? {},
			prev?.operations ?? [],
			changes,
			warnings,
			`libraries.${lib.name}.operations`
		);
		const ownedSettings = applyManagedMap(
			doc,
			['libraries', lib.name, 'settings'],
			lib.settingsOverrides ?? {},
			prev?.settingsKeys ?? [],
			changes,
			warnings,
			`libraries.${lib.name}.settings`
		);
		managedByLib[lib.name] = {
			metadata: lib.metadata,
			defaults: ownedDefaults,
			overlays: ownedOverlays,
			operations: ownedOps,
			settingsKeys: ownedSettings
		};
	}

	// ── Bounded global settings / webhooks ──────────────────────────────────────
	const desiredKeys = new Set(plan.settings.map((s) => `${s.section}.${s.key}`));
	for (const s of plan.settings) {
		const secNode = nodeAt(doc, [s.section]);
		if (secNode !== undefined && hasAliasOrAnchor(secNode)) {
			warnings.push(s.section);
			continue;
		}
		setScalar(doc, [s.section, s.key], s.value, changes);
	}
	// Remove settings we previously managed but the user no longer manages.
	for (const composite of snapshot?.managedSettingKeys ?? []) {
		if (desiredKeys.has(composite)) continue;
		const [section, key] = splitComposite(composite);
		if (scalarAt(doc, [section, key]) !== undefined) {
			const before = scalarAt(doc, [section, key]);
			doc.deleteIn([section, key]);
			changes.push({ op: 'remove', path: composite, before: String(before), after: null });
		}
	}

	const nextSnapshot: KometaSnapshot = {
		metadataPath: plan.metadataFile,
		libraries: managedByLib,
		managedSettingKeys: plan.settings.map((s) => `${s.section}.${s.key}`),
		connections: managedConn
	};

	return { doc, changes, nextSnapshot, warnings: dedupe(warnings) };
}

function splitComposite(composite: string): ['settings' | 'webhooks', string] {
	const idx = composite.indexOf('.');
	const section = composite.slice(0, idx) as 'settings' | 'webhooks';
	return [section, composite.slice(idx + 1)];
}

const EMPTY_KEEP: ReadonlySet<string> = new Set();

/**
 * Set/remove a managed scalar map at `basePath` (a connector section, or a
 * library's `operations`/`settings`). Writes each non-empty value, removes any
 * previously-managed key no longer present, and returns the keys now owned.
 * Skips with a warning if the target node uses anchors/aliases.
 *
 * `keep` lists keys to carry forward untouched when they already exist on disk —
 * used for connector secrets the user left blank (meaning "leave the stored value
 * alone"), so they stay owned and are not deleted.
 */
function applyManagedMap(
	doc: Document,
	basePath: string[],
	values: Record<string, string>,
	prevKeys: string[],
	changes: ChangeEntry[],
	warnings: string[],
	warnLabel: string,
	keep: ReadonlySet<string> = EMPTY_KEEP
): string[] {
	const node = nodeAt(doc, basePath);
	if (node !== undefined && node !== null && hasAliasOrAnchor(node)) {
		warnings.push(warnLabel);
		return prevKeys; // leave untouched, keep the prior ownership record
	}
	const managed: string[] = [];
	for (const [key, value] of Object.entries(values)) {
		if (value === '') continue; // empty = unmanage
		setScalar(doc, [...basePath, key], value, changes);
		managed.push(key);
	}
	// Carry forward kept keys (e.g. blank secrets) that already exist on disk, so
	// they remain owned and the removal pass below does not delete them.
	for (const key of keep) {
		if (!managed.includes(key) && scalarAt(doc, [...basePath, key]) !== undefined) {
			managed.push(key);
		}
	}
	for (const key of prevKeys) {
		if (managed.includes(key)) continue;
		const before = scalarAt(doc, [...basePath, key]);
		if (before !== undefined) {
			doc.deleteIn([...basePath, key]);
			changes.push({
				op: 'remove',
				path: [...basePath, key].join('.'),
				before: String(before),
				after: null
			});
		}
	}
	return managed;
}

/** Ensure exactly one managed `metadata_files` `file:` entry for the library. */
function ensureMetadataEntry(
	doc: Document,
	name: string,
	metadataFile: string,
	snapshot: KometaSnapshot | null,
	changes: ChangeEntry[]
): void {
	const path = ['libraries', name, 'metadata_files'];
	const seq = ensureSeq(doc, path);
	// Drop a stale managed entry if the Kometa-visible path changed since last sync.
	const oldPath = snapshot?.metadataPath;
	if (oldPath && oldPath !== metadataFile) {
		const stale = findMapItem(seq, 'file', oldPath);
		if (stale >= 0) {
			seq.items.splice(stale, 1);
			changes.push({ op: 'remove', path: `${path.join('.')}[file]`, before: oldPath, after: null });
		}
	}
	if (findMapItem(seq, 'file', metadataFile) >= 0) return; // already present → idempotent
	seq.add(doc.createNode({ file: metadataFile }));
	changes.push({ op: 'add', path: `${path.join('.')}[file]`, after: metadataFile });
}

/** Remove the managed metadata entry (used when a library is deselected). */
function removeMetadataEntry(
	doc: Document,
	name: string,
	metadataFile: string,
	changes: ChangeEntry[]
): void {
	const path = ['libraries', name, 'metadata_files'];
	const seq = nodeAt(doc, path);
	if (!isSeq(seq)) return;
	const idx = findMapItem(seq, 'file', metadataFile);
	if (idx < 0) return;
	seq.items.splice(idx, 1);
	changes.push({
		op: 'remove',
		path: `${path.join('.')}[file]`,
		before: metadataFile,
		after: null
	});
	if (seq.items.length === 0) doc.deleteIn(path);
}

/**
 * Add desired defaults / remove no-longer-desired ones we previously added.
 * Returns the set of defaults PosterPilot now *owns* for this library — those we
 * added in this run plus previously-owned ones still desired. A default that the
 * user authored themselves (already present, never in our snapshot) is left out,
 * so a future deselect can never delete it.
 */
function reconcileDefaults(
	doc: Document,
	name: string,
	listKey: string,
	desired: string[],
	prevDefaults: string[],
	changes: ChangeEntry[]
): string[] {
	const path = ['libraries', name, listKey];
	const toRemove = prevDefaults.filter((d) => !desired.includes(d));
	if (toRemove.length) removeDefaults(doc, name, listKey, toRemove, changes);

	const desiredToAdd = desired.filter((d) => {
		const seq = nodeAt(doc, path);
		const present = isSeq(seq) && findMapItem(seq, 'default', d) >= 0;
		return !present;
	});
	if (desiredToAdd.length) {
		const seq = ensureSeq(doc, path);
		for (const d of desiredToAdd) {
			seq.add(doc.createNode({ default: d }));
			changes.push({ op: 'add', path: `${path.join('.')}[default]`, after: d });
		}
	}
	const stillOwned = prevDefaults.filter((d) => desired.includes(d));
	return dedupe([...stillOwned, ...desiredToAdd]);
}

/** Remove specific `- default: <name>` entries we previously added. */
function removeDefaults(
	doc: Document,
	name: string,
	listKey: string,
	defaults: string[],
	changes: ChangeEntry[]
): void {
	const path = ['libraries', name, listKey];
	const seq = nodeAt(doc, path);
	if (!isSeq(seq)) return;
	for (const d of defaults) {
		const idx = findMapItem(seq, 'default', d);
		if (idx < 0) continue;
		seq.items.splice(idx, 1);
		changes.push({
			op: 'remove',
			path: `${path.join('.')}[default]`,
			before: d,
			after: null
		});
	}
	if (seq.items.length === 0) doc.deleteIn(path);
}

/** Build a fresh, minimal config Document from a plan (the missing-file case). */
export function scaffoldDoc(plan: ConfigPlan): Document {
	const doc = parseDocument('');
	const res = applyPlan(doc, plan, null);
	res.doc.commentBefore =
		' Created by PosterPilot. PosterPilot only manages the sections it owns;\n' +
		' add and edit your own keys freely — they will be preserved on sync.';
	return res.doc;
}

/**
 * Build a fully-owned config Document from scratch (own mode). Unlike `merge`,
 * this does NOT preserve any existing content — PosterPilot regenerates the whole
 * file from the plan. The prior file is still backed up by the I/O layer.
 */
export function buildOwnedDoc(plan: ConfigPlan): ApplyResult {
	const res = applyPlan(parseDocument(''), plan, null);
	res.doc.commentBefore =
		' Fully managed by PosterPilot (own mode). Manual edits to this file may be\n' +
		' overwritten on the next sync. Switch to merge mode to keep your own keys.';
	return res;
}

/** The top-level mapping keys present in a document (for own-mode drop reporting). */
export function topLevelKeys(doc: Document): string[] {
	const c = doc.contents;
	if (!isMap(c)) return [];
	return c.items.map((p) => (isScalar(p.key) ? String(p.key.value) : String(p.key)));
}

function keyName(pairKey: unknown): string {
	return isScalar(pairKey) ? String(pairKey.value) : String(pairKey);
}

/** The mapping keys present at a path (e.g. library names under `libraries`). */
export function readSectionKeys(doc: Document, path: (string | number)[]): string[] {
	const node = nodeAt(doc, path);
	if (!isMap(node)) return [];
	return node.items.map((p) => keyName(p.key));
}

/** Read the current scalar key→value map at a path (skips nested maps/seqs). */
export function readScalarMap(doc: Document, path: (string | number)[]): Record<string, string> {
	const node = nodeAt(doc, path);
	if (!isMap(node)) return {};
	const out: Record<string, string> = {};
	for (const pair of node.items) {
		const v = pair.value;
		if (isScalar(v) && v.value != null) out[keyName(pair.key)] = String(v.value);
	}
	return out;
}

/** Read the `- default: <name>` entries from a library's file list. */
export function readDefaultList(doc: Document, libName: string, listKey: string): string[] {
	const seq = nodeAt(doc, ['libraries', libName, listKey]);
	if (!isSeq(seq)) return [];
	const out: string[] = [];
	for (const it of seq.items) {
		if (isMap(it)) {
			const d = it.get('default');
			if (typeof d === 'string') out.push(d);
		}
	}
	return out;
}

/** Read the `- file: <path>` entries from a library's `metadata_files`. */
export function readFileList(doc: Document, libName: string): string[] {
	const seq = nodeAt(doc, ['libraries', libName, 'metadata_files']);
	if (!isSeq(seq)) return [];
	const out: string[] = [];
	for (const it of seq.items) {
		if (isMap(it)) {
			const f = it.get('file');
			if (typeof f === 'string') out.push(f);
		}
	}
	return out;
}

/** A library feature (chart/overlay) that needs a connector that isn't configured. */
export interface ConsistencyWarning {
	library: string;
	feature: string;
	requiresConnector: string;
}

/**
 * Flag enabled chart collections / overlays that require a service connector
 * which is neither in the plan nor already present (non-empty) in the file.
 * Pure and non-blocking — the orchestration surfaces these in the preview.
 */
export function checkConsistency(plan: ConfigPlan, doc: Document): ConsistencyWarning[] {
	const deps = new Map(CONNECTOR_DEPENDENCIES.map((d) => [d.feature, d.requiresConnector]));
	const configured = (section: string): boolean => {
		const planned = plan.connections?.[section];
		if (planned && Object.values(planned).some((v) => v !== '')) return true;
		if (section === 'plex' && plan.creds.plexToken) return true;
		if (section === 'tmdb' && plan.creds.tmdbKey) return true;
		const node = nodeAt(doc, [section]);
		return isMap(node) && node.items.length > 0;
	};
	const out: ConsistencyWarning[] = [];
	for (const lib of plan.libraries) {
		for (const feature of [...lib.defaults, ...(lib.overlays ?? [])]) {
			const req = deps.get(feature);
			if (req && !configured(req)) out.push({ library: lib.name, feature, requiresConnector: req });
		}
	}
	return out;
}

/** Mask secret values in a change list for safe display in the browser. */
export function redactSecrets(changes: ChangeEntry[]): ChangeEntry[] {
	return changes.map((c) =>
		SECRET_PATHS.has(c.path)
			? {
					...c,
					before: c.before == null ? c.before : '***',
					after: c.after == null ? c.after : '***'
				}
			: c
	);
}

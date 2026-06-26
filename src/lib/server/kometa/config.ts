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
import { DEFAULT_FILENAME } from './yaml';
import { knownDefaults } from './defaults-catalog';

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
}

/** A bounded global setting/webhook value to manage. */
export interface ManagedSetting {
	section: 'settings' | 'webhooks';
	key: string;
	value: string;
}

/** The fully-resolved desired managed state. */
export interface ConfigPlan {
	creds: KometaCreds;
	/** Kometa-visible path to `posterpilot.yml` (the `metadata_files` `file:` value). */
	metadataFile: string;
	libraries: PlanLibrary[];
	settings: ManagedSetting[];
}

/** What PosterPilot last wrote, used to compute safe removals on the next sync. */
export interface KometaSnapshot {
	metadataPath: string;
	libraries: Record<string, { metadata: boolean; defaults: string[] }>;
	managedSettingKeys: string[];
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
	libraries: { name: string; defaults: string[]; metadata?: boolean }[];
	settings?: ManagedSetting[];
}): ConfigPlan {
	return {
		creds: input.creds,
		metadataFile: input.metadataFile,
		libraries: input.libraries.map((l) => ({
			name: l.name,
			defaults: dedupe(knownDefaults(l.defaults)),
			metadata: l.metadata ?? true
		})),
		settings: input.settings ?? []
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
		removeDefaults(doc, name, prev.defaults, changes);
	}

	// Add/reconcile managed libraries. Track the defaults we actually own (added or
	// were already managing) so the snapshot never claims a user's pre-existing entry.
	const managedByLib: Record<string, { metadata: boolean; defaults: string[] }> = {};
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

		const prevDefaults = prevLibs[lib.name]?.defaults ?? [];
		const ownedDefaults = reconcileDefaults(doc, lib.name, lib.defaults, prevDefaults, changes);
		managedByLib[lib.name] = { metadata: lib.metadata, defaults: ownedDefaults };
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
		managedSettingKeys: plan.settings.map((s) => `${s.section}.${s.key}`)
	};

	return { doc, changes, nextSnapshot, warnings: dedupe(warnings) };
}

function splitComposite(composite: string): ['settings' | 'webhooks', string] {
	const idx = composite.indexOf('.');
	const section = composite.slice(0, idx) as 'settings' | 'webhooks';
	return [section, composite.slice(idx + 1)];
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
	desired: string[],
	prevDefaults: string[],
	changes: ChangeEntry[]
): string[] {
	const path = ['libraries', name, 'collection_files'];
	const toRemove = prevDefaults.filter((d) => !desired.includes(d));
	if (toRemove.length) removeDefaults(doc, name, toRemove, changes);

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
	defaults: string[],
	changes: ChangeEntry[]
): void {
	const path = ['libraries', name, 'collection_files'];
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

const SECRET_PATHS = new Set(['plex.token', 'tmdb.apikey']);

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

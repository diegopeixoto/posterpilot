import {
	isMap,
	isNode,
	isScalar,
	parseDocument,
	type Document,
	type Node,
	type Pair,
	type YAMLMap
} from 'yaml';
import type { ApplySlot } from '$lib/server/plans/apply-plan';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import {
	assertManagedLogicalKeys,
	findLogicalPair,
	isYamlNull,
	yamlKeyValue
} from '$lib/server/kometa/yaml-logical-keys';

export interface KometaSlotSnapshotValue {
	state: 'present' | 'absent';
	url: string | null;
}

function slotTail(slot: ApplySlot): (string | number)[] {
	if (slot.season === null) {
		return [slot.kind === 'background' ? 'url_background' : 'url_poster'];
	}
	if (slot.kind === 'title_card' && slot.episode !== null) {
		return ['seasons', slot.season, 'episodes', slot.episode, 'url_poster'];
	}
	return ['seasons', slot.season, slot.kind === 'background' ? 'url_background' : 'url_poster'];
}

export type KometaYamlMappingKey = string | number;

function kometaSlotPath(mappingKey: KometaYamlMappingKey, slot: ApplySlot): (string | number)[] {
	return ['metadata', mappingKey, ...slotTail(slot)];
}

function parsed(raw: string): Document<Node> {
	const document = parseDocument(raw) as Document<Node>;
	if (document.errors.length) throw document.errors[0];
	return document;
}

function copyPresentation(source: unknown, target: unknown): void {
	if (!isNode(source) || !isNode(target)) return;
	target.comment = source.comment;
	target.commentBefore = source.commentBefore;
	target.spaceBefore = source.spaceBefore;
}

function createMap(document: Document<Node>): YAMLMap {
	return document.createNode({}) as YAMLMap;
}

function normalizePairKey(document: Document<Node>, pair: Pair, key: string | number): void {
	const current = yamlKeyValue(pair.key);
	if (current === key && typeof current === typeof key) return;
	const replacement = document.createNode(key);
	copyPresentation(pair.key, replacement);
	pair.key = replacement;
}

function ensureMap(document: Document<Node>, parent: YAMLMap, key: string | number): YAMLMap {
	const pair = findLogicalPair(parent, key);
	if (pair && isMap(pair.value)) {
		normalizePairKey(document, pair, key);
		return pair.value;
	}
	if (pair && !isYamlNull(pair.value)) {
		throw new Error('Existing Kometa YAML node is not a mapping');
	}

	const map = createMap(document);
	if (pair) {
		normalizePairKey(document, pair, key);
		copyPresentation(pair.value, map);
		pair.value = map;
	} else {
		parent.items.push(document.createPair(key, map));
	}
	return map;
}

function setScalar(document: Document<Node>, parent: YAMLMap, key: string, value: string): void {
	const pair = findLogicalPair(parent, key);
	// Mirrors the export-side setScalar: any scalar is a replaceable managed
	// value, only collections are protected hand-authored structure.
	if (pair && isScalar(pair.value)) {
		pair.value.value = value;
		return;
	}
	if (pair) throw new Error('Existing Kometa YAML slot is not a string scalar');

	const scalar = document.createNode(value);
	parent.items.push(document.createPair(key, scalar));
}

/**
 * Create every container as a YAML mapping before inserting numeric IDs.
 * Document.setIn() otherwise interprets a number below a missing parent as a
 * sequence index, producing a sparse array for an empty document.
 */
function setKometaSlot(
	document: Document<Node>,
	mappingKey: KometaYamlMappingKey,
	slot: ApplySlot,
	url: string
): void {
	let root: YAMLMap;
	if (isMap(document.contents)) {
		root = document.contents;
	} else if (isYamlNull(document.contents)) {
		root = createMap(document);
		copyPresentation(document.contents, root);
		document.contents = root;
	} else {
		throw new Error('Existing Kometa YAML root is not a mapping');
	}

	const metadata = ensureMap(document, root, 'metadata');
	const entry = ensureMap(document, metadata, mappingKey);
	if (slot.season === null) {
		setScalar(document, entry, slot.kind === 'background' ? 'url_background' : 'url_poster', url);
		return;
	}

	const seasons = ensureMap(document, entry, 'seasons');
	const season = ensureMap(document, seasons, slot.season);
	if (slot.kind === 'title_card' && slot.episode !== null) {
		const episodes = ensureMap(document, season, 'episodes');
		const episode = ensureMap(document, episodes, slot.episode);
		setScalar(document, episode, 'url_poster', url);
		return;
	}
	setScalar(document, season, slot.kind === 'background' ? 'url_background' : 'url_poster', url);
}

interface ResolvedKometaSlot {
	path: (string | number)[];
	value: string | null;
}

function logicalPathKey(pair: Pair | undefined, fallback: string | number): string | number {
	if (!pair) return fallback;
	const value = yamlKeyValue(pair.key);
	return typeof value === 'string' || typeof value === 'number' ? value : fallback;
}

function optionalMap(
	parent: YAMLMap,
	key: string | number
): { key: string | number; value: YAMLMap | null } {
	const pair = findLogicalPair(parent, key);
	const pathKey = logicalPathKey(pair, key);
	if (!pair || isYamlNull(pair.value)) return { key: pathKey, value: null };
	if (!isMap(pair.value)) throw new Error('Existing Kometa YAML node is not a mapping');
	return { key: pathKey, value: pair.value };
}

function optionalString(
	parent: YAMLMap,
	key: string
): { key: string | number; value: string | null } {
	const pair = findLogicalPair(parent, key);
	const pathKey = logicalPathKey(pair, key);
	if (!pair || isYamlNull(pair.value)) return { key: pathKey, value: null };
	if (!isScalar(pair.value)) {
		throw new Error('Existing Kometa YAML slot is not a string scalar');
	}
	// A non-string scalar — an unquoted number or boolean typo — exports nothing
	// Kometa can use, so it reads as absent rather than failing every managed
	// operation on the entry. Collections above stay fatal: they are
	// hand-authored structure a managed write must not destroy.
	return {
		key: pathKey,
		value: typeof pair.value.value === 'string' ? pair.value.value : null
	};
}

function resolvedKometaSlot(
	document: Document<Node>,
	mappingKey: KometaYamlMappingKey,
	slot: ApplySlot
): ResolvedKometaSlot {
	const fallback = kometaSlotPath(mappingKey, slot);
	if (isYamlNull(document.contents)) return { path: fallback, value: null };
	if (!isMap(document.contents)) {
		throw new Error('Existing Kometa YAML root is not a mapping');
	}

	const metadata = optionalMap(document.contents, 'metadata');
	if (!metadata.value) return { path: fallback, value: null };
	assertManagedLogicalKeys(metadata.value);
	const entry = optionalMap(metadata.value, mappingKey);
	const basePath = [metadata.key, entry.key];
	if (!entry.value) return { path: [...basePath, ...slotTail(slot)], value: null };

	if (slot.season === null) {
		const leaf = optionalString(
			entry.value,
			slot.kind === 'background' ? 'url_background' : 'url_poster'
		);
		return { path: [...basePath, leaf.key], value: leaf.value };
	}

	const seasons = optionalMap(entry.value, 'seasons');
	const season = seasons.value ? optionalMap(seasons.value, slot.season) : null;
	const seasonPath = [...basePath, seasons.key, season?.key ?? slot.season];
	if (!season?.value) {
		const missingTail =
			slot.kind === 'title_card' && slot.episode !== null
				? ['episodes', slot.episode, 'url_poster']
				: [slot.kind === 'background' ? 'url_background' : 'url_poster'];
		return { path: [...seasonPath, ...missingTail], value: null };
	}

	if (slot.kind === 'title_card' && slot.episode !== null) {
		const episodes = optionalMap(season.value, 'episodes');
		const episode = episodes.value ? optionalMap(episodes.value, slot.episode) : null;
		const episodePath = [...seasonPath, episodes.key, episode?.key ?? slot.episode];
		if (!episode?.value) return { path: [...episodePath, 'url_poster'], value: null };
		const leaf = optionalString(episode.value, 'url_poster');
		return { path: [...episodePath, leaf.key], value: leaf.value };
	}

	const leaf = optionalString(
		season.value,
		slot.kind === 'background' ? 'url_background' : 'url_poster'
	);
	return { path: [...seasonPath, leaf.key], value: leaf.value };
}

/** Read one exact PosterPilot-managed scalar or its absence. */
export function readKometaSlot(
	raw: string,
	mappingKey: KometaYamlMappingKey,
	slot: ApplySlot
): KometaSlotSnapshotValue {
	const document = parsed(raw);
	const { value } = resolvedKometaSlot(document, mappingKey, slot);
	return typeof value === 'string' && value.length > 0
		? { state: 'present', url: value }
		: { state: 'absent', url: null };
}

export function kometaSlotFingerprint(value: KometaSlotSnapshotValue): string {
	return hashCanonicalJson(value);
}

function mapEmpty(document: Document, path: (string | number)[]): boolean {
	const node = document.getIn(path, true);
	return isMap(node) && node.items.length === 0;
}

/** Restore only one managed scalar while retaining unrelated entries and comments. */
export function restoreKometaSlot(
	raw: string,
	mappingKey: KometaYamlMappingKey,
	slot: ApplySlot,
	snapshot: KometaSlotSnapshotValue
): string {
	const document = parsed(raw);
	const resolved = resolvedKometaSlot(document, mappingKey, slot);
	if (snapshot.state === 'present' && snapshot.url) {
		setKometaSlot(document, mappingKey, slot, snapshot.url);
	} else {
		if (!resolved.value) return raw;
		document.deleteIn(resolved.path);
		// Remove only empty containers created/left by this exact managed slot.
		for (let length = resolved.path.length - 1; length >= 2; length--) {
			const parent = resolved.path.slice(0, length);
			if (mapEmpty(document, parent)) document.deleteIn(parent);
			else break;
		}
	}
	return document.toString();
}

export function verifyKometaSlot(
	raw: string,
	mappingKey: KometaYamlMappingKey,
	slot: ApplySlot,
	expected: KometaSlotSnapshotValue
): boolean {
	return (
		kometaSlotFingerprint(readKometaSlot(raw, mappingKey, slot)) === kometaSlotFingerprint(expected)
	);
}

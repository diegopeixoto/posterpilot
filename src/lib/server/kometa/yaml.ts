/**
 * Kometa metadata YAML export for media-kind-specific files.
 *
 * Kometa interprets numeric metadata keys in library context: TMDb for movie
 * libraries and TVDb for show libraries. IMDb keys use their canonical `tt...`
 * form. The typed destination supplies both that key and the only split file a
 * write may touch.
 */

import { join, resolve } from 'node:path';
import {
	isMap,
	isNode,
	isScalar,
	parseDocument,
	stringify,
	type Document,
	type Node,
	type Pair,
	type YAMLMap
} from 'yaml';
import { readConfig, withConfigLock, writeConfigAtomic } from './config-io';
import {
	assertManagedLogicalKeys,
	findLogicalPair,
	isYamlNull,
	yamlKeyValue
} from './yaml-logical-keys';
import {
	isCanonicalKometaNumericId,
	isKometaDestinationV2,
	kometaYamlMappingKey,
	type KometaDestinationV2,
	type KometaMetadataFilename
} from './destination';

/** An episode title card to export under its season. */
export interface KometaEpisodeInput {
	episode: number;
	url: string;
}

/** A season's artwork to export: its poster and/or its episodes' title cards. */
export interface KometaSeasonInput {
	season: number;
	/** Season poster URL. Season backgrounds are intentionally not exported. */
	posterUrl?: string | null;
	episodes?: KometaEpisodeInput[];
}

/** A single item to export to one exact typed Kometa destination. */
export interface KometaItemInput {
	destination: KometaDestinationV2;
	/** Human-readable title, used only for the trailing comment / readability. */
	title: string;
	/** Selected poster asset URL, or null/undefined when none is selected. */
	posterUrl?: string | null;
	/** Selected background asset URL, or null/undefined when none is selected. */
	backgroundUrl?: string | null;
	/** Per-season artwork (season posters + episode title cards), for shows. */
	seasons?: KometaSeasonInput[];
}

/** A single Kometa episode metadata entry (title card via url_poster). */
interface KometaEpisodeEntry {
	url_poster?: string;
}

/** A single Kometa season metadata entry. */
interface KometaSeasonEntry {
	url_poster?: string;
	episodes?: Record<number, KometaEpisodeEntry>;
}

/** A single Kometa metadata entry. */
interface KometaEntry {
	url_poster?: string;
	url_background?: string;
	seasons?: Record<number, KometaSeasonEntry>;
}

type KometaYamlKey = string | number;
type KometaMetadataMap = Map<KometaYamlKey, KometaEntry>;

export interface KometaMetadataObject extends Record<string, unknown> {
	metadata: KometaMetadataMap;
}

/** Build the nested `seasons:` mapping (season posters + episode title cards). */
function buildSeasons(seasons: KometaSeasonInput[]): Record<number, KometaSeasonEntry> | undefined {
	const out: Record<number, KometaSeasonEntry> = {};
	for (const s of seasons) {
		const entry: KometaSeasonEntry = {};
		if (s.posterUrl) entry.url_poster = s.posterUrl;
		if (s.episodes?.length) {
			const episodes: Record<number, KometaEpisodeEntry> = {};
			for (const e of s.episodes) {
				if (e.url) episodes[e.episode] = { url_poster: e.url };
			}
			if (Object.keys(episodes).length) entry.episodes = episodes;
		}
		// Only emit a season that carries a poster or at least one episode title card.
		if (entry.url_poster || entry.episodes) out[s.season] = entry;
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * Build the Kometa entry (url_poster / url_background / seasons) for one item.
 *
 * @param item The item whose poster/background/season URLs to encode.
 * @returns A metadata entry containing only the parts that are set.
 */
function buildEntry(item: KometaItemInput): KometaEntry {
	const entry: KometaEntry = {};
	if (item.posterUrl) entry.url_poster = item.posterUrl;
	if (item.backgroundUrl) entry.url_background = item.backgroundUrl;
	if (item.seasons?.length) {
		const seasons = buildSeasons(item.seasons);
		if (seasons) entry.seasons = seasons;
	}
	return entry;
}

function assertTypedItems(items: KometaItemInput[], allowEmpty: false): KometaMetadataFilename;
function assertTypedItems(
	items: KometaItemInput[],
	allowEmpty: true
): KometaMetadataFilename | null;
function assertTypedItems(
	items: KometaItemInput[],
	allowEmpty: boolean
): KometaMetadataFilename | null {
	if (items.length === 0) {
		if (allowEmpty) return null;
		throw new TypeError('Kometa YAML write requires at least one typed item');
	}

	let filename: KometaMetadataFilename | null = null;
	for (const item of items) {
		if (!isKometaDestinationV2(item.destination)) {
			throw new TypeError('Invalid Kometa destination');
		}
		if (filename !== null && filename !== item.destination.filename) {
			throw new TypeError('Kometa YAML write cannot mix metadata files');
		}
		filename = item.destination.filename;
	}
	return filename;
}

function setMetadataEntry(
	metadata: KometaMetadataMap,
	key: KometaYamlKey,
	entry: KometaEntry
): void {
	const prior = [...metadata.keys()].find((candidate) => String(candidate) === String(key));
	if (prior !== undefined && (prior !== key || typeof prior !== typeof key)) metadata.delete(prior);
	metadata.set(key, entry);
}

function normalizeMetadataKey(key: unknown): KometaYamlKey | null {
	if (typeof key === 'number' && Number.isSafeInteger(key) && key > 0) return key;
	if (isCanonicalKometaNumericId(key)) return Number(key);
	return typeof key === 'string' ? key : null;
}

function metadataMapFrom(value: unknown): KometaMetadataMap {
	const metadata: KometaMetadataMap = new Map();
	const logicalKeys = new Set<string>();
	const entries =
		value instanceof Map
			? value.entries()
			: value && typeof value === 'object' && !Array.isArray(value)
				? Object.entries(value as Record<string, KometaEntry>)
				: [];
	for (const [rawKey, entry] of entries) {
		const key = normalizeMetadataKey(rawKey);
		if (key === null) continue;
		const logicalKey = String(key);
		if (logicalKeys.has(logicalKey)) {
			throw new Error('Ambiguous existing Kometa YAML keys');
		}
		logicalKeys.add(logicalKey);
		setMetadataEntry(metadata, key, entry as KometaEntry);
	}
	return metadata;
}

/** Build a typed Kometa metadata mapping from scratch. */
export function buildMetadataObject(items: KometaItemInput[]): KometaMetadataObject {
	assertTypedItems(items, true);
	const metadata: KometaMetadataMap = new Map();
	for (const item of items) {
		setMetadataEntry(metadata, kometaYamlMappingKey(item.destination), buildEntry(item));
	}
	return { metadata };
}

/**
 * Merge items into an existing parsed Kometa document, updating entries in
 * place rather than duplicating them.
 *
 * Existing keys for the same typed mapping identifier are overwritten with the
 * new URLs; new identifiers are appended. The returned object is a fresh copy — the input
 * `existing` is not mutated. Any non-`metadata` top-level keys present in
 * `existing` are preserved.
 *
 * @param existing A previously parsed Kometa document (possibly empty).
 * @param items Items to update or insert.
 * @returns The merged document with an updated `metadata` mapping.
 */
export function mergeMetadata(
	existing: Record<string, unknown>,
	items: KometaItemInput[]
): KometaMetadataObject {
	assertTypedItems(items, true);
	const merged: Record<string, unknown> = { ...existing };

	const metadata = metadataMapFrom(merged.metadata);

	for (const item of items) {
		const key = kometaYamlMappingKey(item.destination);
		const priorKey = [...metadata.keys()].find((candidate) => String(candidate) === String(key));
		const previous = priorKey === undefined ? undefined : metadata.get(priorKey);
		setMetadataEntry(metadata, key, mergeEntry(previous ?? {}, buildEntry(item)));
	}

	return { ...merged, metadata };
}

/**
 * Merge a freshly-built entry into the existing one for the same mapping ID,
 * field by field, so a granular-only apply (only `seasons`) does not drop a previously
 * exported show-level `url_poster`/`url_background`, and a season re-apply does not
 * drop previously exported episodes. A field present in `next` overwrites; a field
 * absent from `next` is preserved from `existing`.
 */
function mergeEntry(existing: KometaEntry, next: KometaEntry): KometaEntry {
	const out: KometaEntry = { ...existing };
	if (next.url_poster !== undefined) out.url_poster = next.url_poster;
	if (next.url_background !== undefined) out.url_background = next.url_background;
	if (next.seasons) {
		const seasons: Record<number, KometaSeasonEntry> = { ...(existing.seasons ?? {}) };
		for (const [key, nextSeason] of Object.entries(next.seasons)) {
			const season = Number(key);
			const prev = seasons[season] ?? {};
			const mergedSeason: KometaSeasonEntry = { ...prev };
			if (nextSeason.url_poster !== undefined) mergedSeason.url_poster = nextSeason.url_poster;
			if (nextSeason.episodes) {
				mergedSeason.episodes = { ...(prev.episodes ?? {}), ...nextSeason.episodes };
			}
			seasons[season] = mergedSeason;
		}
		out.seasons = seasons;
	}
	return out;
}

/**
 * Serialize a Kometa metadata object to a YAML string.
 *
 * @param obj The object to serialize (typically from buildMetadataObject /
 *   mergeMetadata).
 * @returns A YAML document string.
 */
export function toYaml(obj: Record<string, unknown>): string {
	return stringify(obj);
}

/** Keep comments and whitespace hints when an incompatible node must be replaced. */
function copyPresentation(source: unknown, target: unknown): void {
	if (!isNode(source) || !isNode(target)) return;
	target.comment = source.comment;
	target.commentBefore = source.commentBefore;
	target.spaceBefore = source.spaceBefore;
}

function createMap(document: Document<Node>): YAMLMap {
	return document.createNode({}) as YAMLMap;
}

/** Ensure numeric provider IDs remain YAML integers rather than quoted titles. */
function normalizePairKey(document: Document<Node>, pair: Pair, key: string | number): void {
	const current = yamlKeyValue(pair.key);
	if (current === key && typeof current === typeof key) return;
	const replacement = document.createNode(key);
	copyPresentation(pair.key, replacement);
	pair.key = replacement;
}

/** Get or create a mapping child without replacing a compatible existing node. */
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

/** Update a scalar in place so any inline/before comment stays attached. */
function setScalar(
	document: Document<Node>,
	parent: YAMLMap,
	key: string | number,
	value: string
): void {
	const pair = findLogicalPair(parent, key);
	if (
		pair &&
		isScalar(pair.value) &&
		(typeof pair.value.value === 'string' || pair.value.value === null)
	) {
		pair.value.value = value;
		return;
	}
	if (pair) throw new Error('Existing Kometa YAML slot is not a string scalar');

	const scalar = document.createNode(value);
	parent.items.push(document.createPair(key, scalar));
}

/** Merge one item directly into a YAML document while preserving untouched nodes. */
function mergeItemIntoDocument(
	document: Document<Node>,
	metadata: YAMLMap,
	item: KometaItemInput
): void {
	const entry = ensureMap(document, metadata, kometaYamlMappingKey(item.destination));
	const next = buildEntry(item);
	if (next.url_poster !== undefined) setScalar(document, entry, 'url_poster', next.url_poster);
	if (next.url_background !== undefined) {
		setScalar(document, entry, 'url_background', next.url_background);
	}
	if (!next.seasons) return;

	const seasons = ensureMap(document, entry, 'seasons');
	for (const [seasonKey, nextSeason] of Object.entries(next.seasons)) {
		const season = ensureMap(document, seasons, Number(seasonKey));
		if (nextSeason.url_poster !== undefined) {
			setScalar(document, season, 'url_poster', nextSeason.url_poster);
		}
		if (!nextSeason.episodes) continue;

		const episodes = ensureMap(document, season, 'episodes');
		for (const [episodeKey, nextEpisode] of Object.entries(nextSeason.episodes)) {
			const episode = ensureMap(document, episodes, Number(episodeKey));
			if (nextEpisode.url_poster !== undefined) {
				setScalar(document, episode, 'url_poster', nextEpisode.url_poster);
			}
		}
	}
}

/** Parse and merge without including source text (which may contain secrets) in errors. */
function mergeYamlDocument(raw: string | null, items: KometaItemInput[]): string {
	assertTypedItems(items, false);
	const document = parseDocument(raw ?? '') as Document<Node>;
	if (document.errors.length > 0) {
		throw new Error('Invalid existing Kometa YAML');
	}

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
	assertManagedLogicalKeys(metadata);
	for (const item of items) mergeItemIntoDocument(document, metadata, item);
	return document.toString();
}

/**
 * Write (or update) the Kometa YAML file in the given directory.
 *
 * Derives the one allowed split filename from the supplied typed destinations,
 * reads that file, merges items in place, and writes it atomically. Mixed,
 * forged, empty, and legacy destinations are rejected before filesystem I/O.
 *
 * @param dir Directory to write the file into (created recursively if needed).
 * @param items Items to export.
 * @param opts Optional current-file fingerprint validator.
 */
export async function writeKometaYaml(
	dir: string,
	items: KometaItemInput[],
	opts: {
		validateCurrent?: (raw: string | null) => void | Promise<void>;
		isCancelled?: () => boolean;
	} = {}
): Promise<void> {
	const filename = assertTypedItems(items, false);
	const filePath = resolve(join(dir, filename));

	await withConfigLock(filePath, async () => {
		const current = readConfig(filePath);
		await opts.validateCurrent?.(current);
		if (opts.isCancelled?.()) throw new Error('cancelled');
		const merged = mergeYamlDocument(current, items);
		writeConfigAtomic(filePath, merged, new Date().toISOString());
	});
}

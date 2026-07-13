/**
 * Kometa / PMM metadata YAML export.
 *
 * Mirrors the shape the legacy MediaUX scraper emitted: a top-level `metadata:`
 * mapping keyed by TMDB id, each entry carrying `url_poster` and (optionally)
 * `url_background`. Kometa reads this file and applies the URLs to the matching
 * library item.
 *
 * The structure-building helpers (`buildMetadataObject`, `mergeMetadata`,
 * `toYaml`) are PURE so they can be unit-tested in isolation. Only
 * `writeKometaYaml` touches the filesystem.
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

/** Default file name written into the Kometa assets/config directory. */
export const DEFAULT_FILENAME = 'posterpilot.yml';

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

/** A single item to export, keyed by its TMDB id. */
export interface KometaItemInput {
	/** TMDB id used as the metadata mapping key Kometa matches against. */
	tmdbId: string;
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

/**
 * Build the Kometa `metadata:` mapping keyed by TMDB id from scratch.
 *
 * Each item becomes `metadata[tmdbId] = { url_poster?, url_background? }`,
 * omitting any URL that is not set. When multiple items share a TMDB id, the
 * later item wins.
 *
 * @param items Items to encode.
 * @returns An object of the form `{ metadata: { <tmdbId>: { ... } } }`.
 */
export function buildMetadataObject(items: KometaItemInput[]): Record<string, unknown> {
	const metadata: Record<string, KometaEntry> = {};
	for (const item of items) {
		metadata[item.tmdbId] = buildEntry(item);
	}
	return { metadata };
}

/**
 * Merge items into an existing parsed Kometa document, updating entries in
 * place rather than duplicating them.
 *
 * Existing keys for the same TMDB id are overwritten with the new URLs; new
 * TMDB ids are appended. The returned object is a fresh copy — the input
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
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };

	const rawMetadata = merged.metadata;
	const metadata: Record<string, KometaEntry> =
		rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
			? { ...(rawMetadata as Record<string, KometaEntry>) }
			: {};

	for (const item of items) {
		metadata[item.tmdbId] = mergeEntry(metadata[item.tmdbId] ?? {}, buildEntry(item));
	}

	merged.metadata = metadata;
	return merged;
}

/**
 * Merge a freshly-built entry into the existing one for the same TMDB id, field by
 * field, so a granular-only apply (only `seasons`) does not drop a previously
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

/** Return the plain value of a scalar map key without resolving the document. */
function keyValue(key: unknown): unknown {
	return isScalar(key) ? key.value : key;
}

/**
 * Find a map pair while treating quoted and unquoted numeric keys as the same
 * logical Kometa identifier. This matters because YAML parses `550:` as a
 * number, while PosterPilot receives TMDB ids as strings.
 */
function findPair(map: YAMLMap, key: string | number): Pair | undefined {
	return map.items.find((pair) => String(keyValue(pair.key)) === String(key));
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

/** Get or create a mapping child without replacing a compatible existing node. */
function ensureMap(document: Document<Node>, parent: YAMLMap, key: string | number): YAMLMap {
	const pair = findPair(parent, key);
	if (pair && isMap(pair.value)) return pair.value;

	const map = createMap(document);
	if (pair) {
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
	const pair = findPair(parent, key);
	if (pair && isScalar(pair.value)) {
		pair.value.value = value;
		return;
	}

	const scalar = document.createNode(value);
	if (pair) {
		copyPresentation(pair.value, scalar);
		pair.value = scalar;
	} else {
		parent.items.push(document.createPair(key, scalar));
	}
}

/** Merge one item directly into a YAML document while preserving untouched nodes. */
function mergeItemIntoDocument(
	document: Document<Node>,
	metadata: YAMLMap,
	item: KometaItemInput
): void {
	const entry = ensureMap(document, metadata, item.tmdbId);
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
	const document = parseDocument(raw ?? '') as Document<Node>;
	if (document.errors.length > 0) {
		throw new Error('Invalid existing Kometa YAML');
	}

	let root: YAMLMap;
	if (isMap(document.contents)) {
		root = document.contents;
	} else {
		root = createMap(document);
		copyPresentation(document.contents, root);
		document.contents = root;
	}

	const metadata = ensureMap(document, root, 'metadata');
	for (const item of items) mergeItemIntoDocument(document, metadata, item);
	return document.toString();
}

/**
 * Write (or update) the Kometa YAML file in the given directory.
 *
 * Ensures `dir` exists, reads any pre-existing YAML file, merges the supplied
 * items in place (no duplicate TMDB keys), and writes the result back.
 *
 * @param dir Directory to write the file into (created recursively if needed).
 * @param items Items to export.
 * @param opts Optional settings; `filename` defaults to `posterpilot.yml`.
 */
export async function writeKometaYaml(
	dir: string,
	items: KometaItemInput[],
	opts: { filename?: string; validateCurrent?: (raw: string | null) => void } = {}
): Promise<void> {
	const filename = opts.filename ?? DEFAULT_FILENAME;
	const filePath = resolve(join(dir, filename));

	await withConfigLock(filePath, async () => {
		const current = readConfig(filePath);
		opts.validateCurrent?.(current);
		const merged = mergeYamlDocument(current, items);
		writeConfigAtomic(filePath, merged, new Date().toISOString());
	});
}

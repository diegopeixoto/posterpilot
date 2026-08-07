/**
 * Kometa metadata matching contract.
 *
 * Verified against Kometa 2.0.0 through 2.4.6: numeric mapping names resolve as
 * TMDb in movie libraries and TVDb in show libraries, while `tt...` resolves as
 * IMDb in either library type. See https://kometa.wiki/en/latest/files/metadata/#matching-items.
 */

/** Legacy mixed-kind metadata filename. New exports must never target this file. */
export const LEGACY_FILENAME = 'posterpilot.yml' as const;

/** Metadata file attached only to authoritative movie libraries. */
export const MOVIE_FILENAME = 'posterpilot-movies.yml' as const;

/** Metadata file attached only to authoritative show libraries. */
export const SHOW_FILENAME = 'posterpilot-shows.yml' as const;

export type KometaMediaKind = 'movie' | 'show';
export type KometaIdentifierNamespace = 'tmdb' | 'tvdb' | 'imdb';
export type KometaMetadataFilename = typeof MOVIE_FILENAME | typeof SHOW_FILENAME;

/** Exact destination identity frozen into new Kometa plans and revisions. */
export interface KometaDestinationV2 {
	version: 2;
	mediaKind: KometaMediaKind;
	namespace: KometaIdentifierNamespace;
	mappingId: string;
	filename: KometaMetadataFilename;
	key: string;
}

/**
 * Explicitly recorded destination for pre-split revisions.
 *
 * It intentionally has no media kind: a legacy numeric key cannot prove one.
 */
export interface KometaLegacyDestinationV1 {
	version: 1;
	filename: typeof LEGACY_FILENAME;
	namespace: 'tmdb';
	mappingId: string;
	key: string;
}

export interface KometaDestinationInput {
	type: KometaMediaKind;
	tmdbId?: string | null;
	tvdbId?: string | null;
	imdbId?: string | null;
}

export type ResolveKometaDestinationResult =
	| { ok: true; destination: KometaDestinationV2 }
	| { ok: false; reason: 'missing_kometa_identifier' };

const NUMERIC_MAPPING_ID = /^[1-9]\d*$/;
const IMDB_MAPPING_ID = /^tt\d{7,}$/;

/** Numeric Kometa mapping IDs must round-trip to an unquoted safe YAML integer. */
export function isCanonicalKometaNumericId(value: unknown): value is string {
	if (typeof value !== 'string' || !NUMERIC_MAPPING_ID.test(value)) return false;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value;
}

/** IMDb mapping IDs are lowercase canonical title identifiers (`tt` + digits). */
export function isCanonicalKometaImdbId(value: unknown): value is string {
	return typeof value === 'string' && IMDB_MAPPING_ID.test(value);
}

function isKometaMetadataFilename(value: unknown): value is KometaMetadataFilename {
	return value === MOVIE_FILENAME || value === SHOW_FILENAME;
}

function kometaFilenameForMediaKind(kind: KometaMediaKind): KometaMetadataFilename {
	return kind === 'movie' ? MOVIE_FILENAME : SHOW_FILENAME;
}

function kometaDestinationKey(input: {
	mediaKind: KometaMediaKind;
	namespace: KometaIdentifierNamespace;
	mappingId: string;
	filename: KometaMetadataFilename;
}): string {
	return `kometa:v2:${input.mediaKind}:${input.namespace}:${input.mappingId}:${input.filename}`;
}

export function legacyKometaDestinationKey(mappingId: string): string {
	return `kometa:v1:legacy:tmdb:${mappingId}:${LEGACY_FILENAME}`;
}

function validNamespaceForKind(
	mediaKind: KometaMediaKind,
	namespace: KometaIdentifierNamespace
): boolean {
	return (
		namespace === 'imdb' || (mediaKind === 'movie' ? namespace === 'tmdb' : namespace === 'tvdb')
	);
}

function validMappingId(
	namespace: KometaIdentifierNamespace,
	mappingId: unknown
): mappingId is string {
	return namespace === 'imdb'
		? isCanonicalKometaImdbId(mappingId)
		: isCanonicalKometaNumericId(mappingId);
}

function makeDestination(
	mediaKind: KometaMediaKind,
	namespace: KometaIdentifierNamespace,
	mappingId: string
): KometaDestinationV2 {
	const filename = kometaFilenameForMediaKind(mediaKind);
	const identity = { mediaKind, namespace, mappingId, filename };
	return { version: 2, ...identity, key: kometaDestinationKey(identity) };
}

/**
 * Resolve the identifier Kometa understands in the authoritative library context.
 *
 * Numeric metadata mappings mean TMDb in movie libraries and TVDb in show
 * libraries. IMDb (`tt...`) is the supported fallback for either kind. A TMDb
 * show match never changes this routing decision.
 */
export function resolveKometaDestination(
	input: KometaDestinationInput
): ResolveKometaDestinationResult {
	if (input.type === 'movie') {
		if (isCanonicalKometaNumericId(input.tmdbId)) {
			return { ok: true, destination: makeDestination('movie', 'tmdb', input.tmdbId) };
		}
		if (isCanonicalKometaImdbId(input.imdbId)) {
			return { ok: true, destination: makeDestination('movie', 'imdb', input.imdbId) };
		}
	} else if (input.type === 'show') {
		if (isCanonicalKometaNumericId(input.tvdbId)) {
			return { ok: true, destination: makeDestination('show', 'tvdb', input.tvdbId) };
		}
		if (isCanonicalKometaImdbId(input.imdbId)) {
			return { ok: true, destination: makeDestination('show', 'imdb', input.imdbId) };
		}
	}

	return { ok: false, reason: 'missing_kometa_identifier' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate an untrusted frozen V2 destination, including its derived key. */
export function isKometaDestinationV2(value: unknown): value is KometaDestinationV2 {
	if (!isRecord(value)) return false;
	const { version, mediaKind, namespace, mappingId, filename, key } = value;
	if (
		version !== 2 ||
		(mediaKind !== 'movie' && mediaKind !== 'show') ||
		(namespace !== 'tmdb' && namespace !== 'tvdb' && namespace !== 'imdb') ||
		!validNamespaceForKind(mediaKind, namespace) ||
		!validMappingId(namespace, mappingId) ||
		!isKometaMetadataFilename(filename) ||
		filename !== kometaFilenameForMediaKind(mediaKind) ||
		typeof key !== 'string'
	) {
		return false;
	}
	return key === kometaDestinationKey({ mediaKind, namespace, mappingId, filename });
}

/** Parse a versioned destination key without inferring any missing field. */
export function parseKometaDestinationKey(value: unknown): KometaDestinationV2 | null {
	if (typeof value !== 'string') return null;
	const [prefix, version, mediaKind, namespace, mappingId, filename, ...extra] = value.split(':');
	if (
		prefix !== 'kometa' ||
		version !== 'v2' ||
		extra.length > 0 ||
		(mediaKind !== 'movie' && mediaKind !== 'show') ||
		(namespace !== 'tmdb' && namespace !== 'tvdb' && namespace !== 'imdb') ||
		!isKometaMetadataFilename(filename)
	) {
		return null;
	}
	const destination: KometaDestinationV2 = {
		version: 2,
		mediaKind,
		namespace,
		mappingId,
		filename,
		key: value
	};
	return isKometaDestinationV2(destination) ? destination : null;
}

/** Validate an explicitly recorded legacy destination; never infer one from V2. */
export function isKometaLegacyDestinationV1(value: unknown): value is KometaLegacyDestinationV1 {
	if (!isRecord(value)) return false;
	return (
		value.version === 1 &&
		value.filename === LEGACY_FILENAME &&
		value.namespace === 'tmdb' &&
		isCanonicalKometaNumericId(value.mappingId) &&
		typeof value.key === 'string' &&
		value.key === legacyKometaDestinationKey(value.mappingId)
	);
}

export function parseKometaLegacyDestinationKey(value: unknown): KometaLegacyDestinationV1 | null {
	if (typeof value !== 'string') return null;
	const [prefix, version, layout, namespace, mappingId, filename, ...extra] = value.split(':');
	if (
		prefix !== 'kometa' ||
		version !== 'v1' ||
		layout !== 'legacy' ||
		namespace !== 'tmdb' ||
		filename !== LEGACY_FILENAME ||
		extra.length > 0
	) {
		return null;
	}
	const destination: KometaLegacyDestinationV1 = {
		version: 1,
		filename: LEGACY_FILENAME,
		namespace: 'tmdb',
		mappingId,
		key: value
	};
	return isKometaLegacyDestinationV1(destination) ? destination : null;
}

/** YAML mapping scalar required by the exact typed or explicitly recorded legacy destination. */
export function kometaYamlMappingKey(
	destination: KometaDestinationV2 | KometaLegacyDestinationV1
): string | number {
	if (!isKometaDestinationV2(destination) && !isKometaLegacyDestinationV1(destination)) {
		throw new TypeError('Invalid Kometa destination');
	}
	return destination.namespace === 'imdb' ? destination.mappingId : Number(destination.mappingId);
}

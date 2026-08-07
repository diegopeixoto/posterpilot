/**
 * Kometa resolves `file:` entries from its own runtime view of the filesystem.
 * Keep that relative reference separate from PosterPilot's physical output path:
 * this client-safe module never joins or resolves a local filesystem path.
 */

export const DEFAULT_KOMETA_METADATA_PATH_PREFIX = 'config';

export type KometaMetadataPathPrefixErrorCode =
	| 'absolute'
	| 'control'
	| 'empty_segment'
	| 'filename'
	| 'reserved'
	| 'too_long'
	| 'traversal'
	| 'url';

export class KometaMetadataPathPrefixError extends TypeError {
	constructor(readonly code: KometaMetadataPathPrefixErrorCode) {
		super(`Invalid Kometa metadata path prefix: ${code}`);
		this.name = 'KometaMetadataPathPrefixError';
	}
}

const MAX_PREFIX_LENGTH = 240;
const MAX_SEGMENT_LENGTH = 255;
const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const YAML_FILENAME = /\.ya?ml$/i;

function invalid(code: KometaMetadataPathPrefixErrorCode): never {
	throw new KometaMetadataPathPrefixError(code);
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 0x1f || codePoint === 0x7f) return true;
	}
	return false;
}

/**
 * Validate and canonicalize the directory prefix used in Kometa `file:` entries.
 * Empty and `.` explicitly mean "no prefix". Output always uses `/`, including
 * when the input came from a Windows host.
 */
export function normalizeKometaMetadataPathPrefix(input: string): string {
	if (typeof input !== 'string') invalid('reserved');
	if (hasControlCharacter(input)) invalid('control');
	const trimmed = input.trim().normalize('NFC');
	if (trimmed === '' || trimmed === '.' || trimmed === './' || trimmed === '.\\') return '';
	if (/^(?:[/\\]{2}|\\[?.]\\)/.test(trimmed)) invalid('absolute');
	if (/^[a-z]:[/\\]/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
		invalid('absolute');
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) invalid('url');

	let normalized = trimmed.replaceAll('\\', '/');
	while (normalized.startsWith('./')) normalized = normalized.slice(2);
	if (normalized === '' || normalized === '.') return '';
	if (normalized.startsWith('/')) invalid('absolute');
	// One optional trailing separator is presentation-only. Repeated separators
	// still leave an empty segment and are rejected below.
	if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
	if (normalized.length > MAX_PREFIX_LENGTH) invalid('too_long');

	const segments = normalized.split('/');
	if (segments.some((segment) => segment === '')) invalid('empty_segment');
	if (segments.some((segment) => segment === '.' || segment === '..')) invalid('traversal');
	for (const segment of segments) {
		if (segment.length > MAX_SEGMENT_LENGTH) invalid('too_long');
		if (
			WINDOWS_RESERVED_CHARACTERS.test(segment) ||
			/[. ]$/.test(segment) ||
			WINDOWS_RESERVED_NAMES.test(segment)
		) {
			invalid('reserved');
		}
	}
	if (YAML_FILENAME.test(segments.at(-1) ?? '')) invalid('filename');
	return segments.join('/');
}

function assertBasename(filename: string): void {
	if (
		!filename ||
		filename === '.' ||
		filename === '..' ||
		filename.includes('/') ||
		filename.includes('\\') ||
		hasControlCharacter(filename)
	) {
		invalid('filename');
	}
}

/** Build a canonical Kometa-visible reference without touching a physical path. */
export function kometaMetadataReference(prefix: string, filename: string): string {
	assertBasename(filename);
	const normalizedPrefix = normalizeKometaMetadataPathPrefix(prefix);
	return normalizedPrefix ? `${normalizedPrefix}/${filename}` : filename;
}

/**
 * Validate a complete metadata reference against its physical basename and
 * return the canonical `/`-separated representation.
 */
export function normalizeKometaMetadataReference(
	reference: string,
	expectedFilename: string
): string {
	assertBasename(expectedFilename);
	if (typeof reference !== 'string' || hasControlCharacter(reference)) {
		invalid('control');
	}
	const normalized = reference.trim().normalize('NFC').replaceAll('\\', '/');
	const separator = normalized.lastIndexOf('/');
	const filename = separator >= 0 ? normalized.slice(separator + 1) : normalized;
	if (filename !== expectedFilename) invalid('filename');
	const prefix = separator >= 0 ? normalized.slice(0, separator) : '';
	if (prefix.endsWith('/')) invalid('empty_segment');
	return kometaMetadataReference(prefix, expectedFilename);
}

/** Extract a normalized basename for read-only classification of existing refs. */
export function kometaMetadataReferenceBasename(reference: string): string | null {
	if (typeof reference !== 'string') return null;
	const normalized = reference.trim().replaceAll('\\', '/');
	if (!normalized || normalized.endsWith('/')) return null;
	const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
	return basename || null;
}

import { parse } from 'yaml';
import { LEGACY_FILENAME } from './destination';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Match a Kometa-visible reference by basename, including Docker path prefixes. */
export function isLegacyKometaMetadataReference(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const normalized = value.trim().replaceAll('\\', '/');
	return normalized.split('/').at(-1) === LEGACY_FILENAME;
}

/**
 * Inspect only the bounded `libraries.*.metadata_files[].file` structure.
 * `known=false` makes callers fail closed when the active config shape cannot be
 * classified without guessing.
 */
export function classifyKometaLegacyConfig(raw: string): {
	known: boolean;
	references: string[];
} {
	let parsed: unknown;
	try {
		parsed = parse(raw);
	} catch {
		return { known: false, references: [] };
	}
	if (parsed === null || parsed === undefined) return { known: true, references: [] };
	if (!isObject(parsed)) return { known: false, references: [] };
	const libraries = parsed.libraries;
	if (libraries === null || libraries === undefined) return { known: true, references: [] };
	if (!isObject(libraries)) return { known: false, references: [] };

	let known = true;
	const references: string[] = [];
	for (const [libraryName, rawLibrary] of Object.entries(libraries)) {
		if (!isObject(rawLibrary)) {
			known = false;
			continue;
		}
		const metadataFiles = rawLibrary.metadata_files;
		if (metadataFiles === null || metadataFiles === undefined) continue;
		if (!Array.isArray(metadataFiles)) {
			known = false;
			continue;
		}
		for (const rawEntry of metadataFiles) {
			if (!isObject(rawEntry)) {
				known = false;
				continue;
			}
			if (rawEntry.file === undefined) continue;
			if (typeof rawEntry.file !== 'string') {
				known = false;
				continue;
			}
			if (isLegacyKometaMetadataReference(rawEntry.file)) references.push(libraryName);
		}
	}
	return { known, references: [...new Set(references)].sort() };
}

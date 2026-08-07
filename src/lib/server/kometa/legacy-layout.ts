import { isAlias, isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap } from 'yaml';
import { LEGACY_FILENAME } from './destination';

function isYamlNull(value: unknown): boolean {
	return value === null || (isScalar(value) && value.value === null);
}

function isMergePair(pair: Pair): boolean {
	return isScalar(pair.key) && pair.key.value === '<<';
}

/**
 * Reject indirection that can synthesize a key at the mapping level currently
 * being classified. Aliases in unrelated values are safe because they cannot
 * change the direct `libraries` / `metadata_files` / `file` path.
 */
function hasShapeIndirection(map: YAMLMap): boolean {
	return map.items.some((pair) => isMergePair(pair) || isAlias(pair.key));
}

function librariesPair(root: YAMLMap): Pair | null {
	const pairs = root.items.filter((pair) => isScalar(pair.key) && pair.key.value === 'libraries');
	return pairs.length === 1 ? pairs[0] : null;
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
	let document: ReturnType<typeof parseDocument>;
	try {
		document = parseDocument(raw, { uniqueKeys: true });
	} catch {
		return { known: false, references: [] };
	}
	if (document.errors.length > 0) return { known: false, references: [] };
	const root = document.contents;
	if (isYamlNull(root)) return { known: true, references: [] };
	if (!isMap(root)) return { known: false, references: [] };

	// A root merge or alias key can synthesize `libraries` without a direct pair.
	if (hasShapeIndirection(root)) {
		return { known: false, references: [] };
	}
	const pair = librariesPair(root);
	if (!pair) {
		const hasLibrariesKey = root.items.some(
			(entry) => isScalar(entry.key) && entry.key.value === 'libraries'
		);
		return { known: !hasLibrariesKey, references: [] };
	}
	const libraries = pair.value;
	if (isYamlNull(libraries)) return { known: true, references: [] };
	if (!isMap(libraries) || hasShapeIndirection(libraries)) {
		return { known: false, references: [] };
	}

	let known = true;
	const references: string[] = [];
	for (const libraryPair of libraries.items) {
		if (
			!isScalar(libraryPair.key) ||
			typeof libraryPair.key.value !== 'string' ||
			libraryPair.key.value.length === 0
		) {
			known = false;
			continue;
		}
		const libraryName = libraryPair.key.value;
		if (!isMap(libraryPair.value) || hasShapeIndirection(libraryPair.value)) {
			known = false;
			continue;
		}
		const metadataFiles = libraryPair.value.get('metadata_files', true);
		if (metadataFiles === undefined || isYamlNull(metadataFiles)) continue;
		if (!isSeq(metadataFiles)) {
			known = false;
			continue;
		}
		for (const rawEntry of metadataFiles.items) {
			if (!isMap(rawEntry) || hasShapeIndirection(rawEntry)) {
				known = false;
				continue;
			}
			const file = rawEntry.get('file', true);
			if (file === undefined) continue;
			if (!isScalar(file) || typeof file.value !== 'string') {
				known = false;
				continue;
			}
			if (isLegacyKometaMetadataReference(file.value)) references.push(libraryName);
		}
	}
	return { known, references: [...new Set(references)].sort() };
}

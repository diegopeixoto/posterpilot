import type { KometaConfigMode } from '$lib/server/config';
import {
	isAlias,
	isMap,
	isScalar,
	isSeq,
	stringify,
	type Pair,
	type Scalar,
	type YAMLMap,
	type YAMLSeq
} from 'yaml';
import type { KometaSnapshot, ManagedLib } from './config';
import { parseBoundedKometaConfig, type KometaConfigYamlLimitOverrides } from './config-yaml';
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	type KometaMediaKind
} from './destination';
import { isLegacyKometaMetadataReference } from './legacy-layout';
import { kometaFileFingerprint } from './plan';
import {
	kometaMetadataReference,
	kometaMetadataReferenceBasename,
	normalizeKometaMetadataPathPrefix,
	normalizeKometaMetadataReference
} from './reference-path';

export interface AuthoritativeKometaLibrary {
	/** Exact Kometa `libraries:` key; matching is deliberately title-sensitive. */
	title: string;
	/** Raw server-library type. Only `movie` and `show` are migration-compatible. */
	type: string;
}

export interface KometaMigrationConfigReferences {
	movie: string;
	show: string;
}

export interface PlanKometaMigrationConfigInput {
	rawConfig: string;
	mode: KometaConfigMode;
	snapshot: KometaSnapshot | null;
	metadataPathPrefix: string;
	references: KometaMigrationConfigReferences;
	/** Authoritative libraries in the bound migration scope. */
	libraries: readonly AuthoritativeKometaLibrary[];
	/** Tests may lower the hard config parser limits; production callers omit this. */
	configLimits?: KometaConfigYamlLimitOverrides;
}

export type KometaMigrationConfigReasonCode =
	| 'conflicting_authoritative_types'
	| 'config_limit_exceeded'
	| 'invalid_yaml'
	| 'missing_typed_reference'
	| 'no_authoritative_libraries'
	| 'typed_reference_conflict'
	| 'unknown_library'
	| 'unsupported_config_shape'
	| 'unsupported_library_type'
	| 'unowned_legacy_reference'
	| 'yaml_alias_or_anchor';

export interface KometaMigrationConfigReason {
	code: KometaMigrationConfigReasonCode;
	/** Present only when the failure can be attributed to a safe library title. */
	library?: string;
}

export type KometaMigrationConfigWarning = 'manual_wiring_required' | 'no_legacy_references';

export type KometaMigrationConfigIncompatibilityReason =
	| 'conflicting_authoritative_types'
	| 'unknown_library'
	| 'unsupported_library_type';

export interface KometaMigrationConfigIncompatibility {
	library: string;
	reason: KometaMigrationConfigIncompatibilityReason;
	/** Synced section titles that differ only by accents/case, for `unknown_library`. */
	suggestion?: string;
}

/**
 * One library-attributed obstacle, surfaced verbatim to the UI so the banner
 * can say *which* library and *why* instead of a generic paragraph.
 */
export interface KometaMigrationIncompatibilityDetail {
	library: string;
	reason: KometaMigrationConfigReasonCode;
	suggestion?: string;
}

/** Public preview entry. The legacy path is reduced to its non-sensitive basename. */
export interface KometaMigrationConfigLibraryChange {
	library: string;
	mediaKind: KometaMediaKind;
	/** Redacted basenames only; an empty list means the current safe shape is unknown/absent. */
	before: (typeof LEGACY_FILENAME | typeof MOVIE_FILENAME | typeof SHOW_FILENAME)[];
	after: string;
}

/** One config entry the rewrite deletes and the user must explicitly accept. */
export interface KometaMigrationConfigEntryRemoval {
	library: string;
	/** The reference exactly as written in config.yml. */
	reference: string;
}

export interface KometaMigrationConfigPlan {
	activation: 'managed' | 'manual';
	sourceFingerprint: string;
	/** Exact server-side config bytes. Always null for manual activation. */
	proposedContent: string | null;
	proposedFingerprint: string | null;
	nextSnapshot: KometaSnapshot;
	changes: KometaMigrationConfigLibraryChange[];
	warnings: KometaMigrationConfigWarning[];
	reasons: KometaMigrationConfigReason[];
	incompatibleLibraries: KometaMigrationConfigIncompatibility[];
	/**
	 * Distinct-path repeats of the legacy reference the managed rewrite removes.
	 * A basename match cannot prove two paths are one file, so these removals
	 * are shown in the preview and gated behind explicit acknowledgment at
	 * confirmation instead of being absorbed silently.
	 */
	entryRemovals: KometaMigrationConfigEntryRemoval[];
	legacyReferenceCount: number;
	/** False when the shown manual wiring cannot cover every active/possible legacy reference. */
	manualWiringActionable: boolean;
	/** Exact URL-free per-library reference guide for manual wiring; null for managed activation. */
	manualSnippet: string | null;
}

interface ResolvedLibrary {
	title: string;
	type: KometaMediaKind;
}

interface LegacyReference {
	library: string;
	reference: string;
	node: Scalar;
	/** The metadata_files sequence and this reference's entry, for removing duplicates. */
	container: YAMLSeq;
	entry: YAMLMap;
	type: KometaMediaKind | null;
	targetReference: string | null;
	/**
	 * Another reference in the same library is the rewrite target; this one is
	 * removed. Identical repeats collapse quietly into the surviving change's
	 * before-list; distinct paths additionally require explicit acknowledgment.
	 */
	duplicate: false | 'identical' | 'distinct';
}

interface LibraryScan {
	legacy: LegacyReference[];
	typedReferences: string[];
}

function dedupeBy<T>(values: T[], identity: (value: T) => string): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const key = identity(value);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function reasonIdentity(reason: KometaMigrationConfigReason): string {
	return `${reason.code}\0${reason.library ?? ''}`;
}

function incompatibilityIdentity(value: KometaMigrationConfigIncompatibility): string {
	return `${value.reason}\0${value.library}`;
}

function isYamlNull(node: unknown): boolean {
	return node === null || (isScalar(node) && node.value === null);
}

function isMergePair(pair: Pair): boolean {
	return isScalar(pair.key) && pair.key.value === '<<';
}

function hasShapeIndirection(map: YAMLMap): boolean {
	return map.items.some((pair) => isMergePair(pair) || isAlias(pair.key));
}

function hasNodeAnchor(node: unknown): boolean {
	return (isScalar(node) || isMap(node) || isSeq(node)) && Boolean(node.anchor);
}

/**
 * Reject indirection only where it can affect the direct path we inspect and
 * mutate: `libraries.*.metadata_files[].file`. Aliases in sibling settings are
 * unrelated to that shape and must survive a merge-mode migration unchanged.
 */
function hasRelevantIndirection(root: YAMLMap, librariesNode: unknown): boolean {
	if (root.anchor || hasShapeIndirection(root)) return true;
	if (librariesNode === undefined || isYamlNull(librariesNode)) return false;
	if (isAlias(librariesNode)) return true;
	if (!isMap(librariesNode)) return false;
	if (librariesNode.anchor || hasShapeIndirection(librariesNode)) return true;

	for (const libraryPair of librariesNode.items) {
		const libraryNode = libraryPair.value;
		if (isYamlNull(libraryNode)) continue;
		if (isAlias(libraryNode)) return true;
		if (!isMap(libraryNode)) continue;
		if (libraryNode.anchor || hasShapeIndirection(libraryNode)) return true;

		const metadataFiles = libraryNode.get('metadata_files', true);
		if (metadataFiles === undefined || isYamlNull(metadataFiles)) continue;
		if (isAlias(metadataFiles)) return true;
		if (!isSeq(metadataFiles)) continue;
		if (metadataFiles.anchor) return true;

		for (const item of metadataFiles.items) {
			if (isAlias(item)) return true;
			if (!isMap(item)) continue;
			if (item.anchor || hasShapeIndirection(item)) return true;
			const fileNode = item.get('file', true);
			if (isAlias(fileNode) || hasNodeAnchor(fileNode)) return true;
		}
	}
	return false;
}

/** Accent- and case-insensitive fold, for suggesting near-miss section names. */
function foldTitle(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.trim();
}

/**
 * Synced section titles that plausibly correspond to an unmatched config
 * library name: equal after folding, or containing/contained by it. Matching is
 * deliberately loose — this is a hint for a human, never used to migrate.
 */
function suggestSections(library: string, titles: Iterable<string>): string | undefined {
	const folded = foldTitle(library);
	if (!folded) return undefined;
	const matches: string[] = [];
	for (const title of titles) {
		const candidate = foldTitle(title);
		if (candidate === folded || candidate.includes(folded) || folded.includes(candidate)) {
			matches.push(title);
		}
	}
	return matches.length > 0 && matches.length <= 3 ? matches.join(', ') : undefined;
}

function resolveAuthoritativeLibraries(libraries: readonly AuthoritativeKometaLibrary[]): {
	resolved: ResolvedLibrary[];
	byTitle: Map<string, KometaMediaKind | null>;
	incompatible: KometaMigrationConfigIncompatibility[];
} {
	const typesByTitle = new Map<string, string[]>();
	const order: string[] = [];
	for (const library of libraries) {
		if (typeof library.title !== 'string' || library.title.length === 0) {
			throw new TypeError('Authoritative Kometa library title must be non-empty');
		}
		if (!typesByTitle.has(library.title)) {
			typesByTitle.set(library.title, []);
			order.push(library.title);
		}
		typesByTitle.get(library.title)?.push(library.type);
	}

	const resolved: ResolvedLibrary[] = [];
	const byTitle = new Map<string, KometaMediaKind | null>();
	const incompatible: KometaMigrationConfigIncompatibility[] = [];
	for (const title of order) {
		const types = [...(typesByTitle.get(title) ?? [])];
		if (types.length !== 1) {
			byTitle.set(title, null);
			incompatible.push({ library: title, reason: 'conflicting_authoritative_types' });
			continue;
		}
		const type = types[0];
		if (type !== 'movie' && type !== 'show') {
			byTitle.set(title, null);
			incompatible.push({ library: title, reason: 'unsupported_library_type' });
			continue;
		}
		byTitle.set(title, type);
		resolved.push({ title, type });
	}
	return { resolved, byTitle, incompatible };
}

function validateReferences(input: PlanKometaMigrationConfigInput): {
	metadataPathPrefix: string;
	references: KometaMigrationConfigReferences;
} {
	const metadataPathPrefix = normalizeKometaMetadataPathPrefix(input.metadataPathPrefix);
	const expected = {
		movie: kometaMetadataReference(metadataPathPrefix, MOVIE_FILENAME),
		show: kometaMetadataReference(metadataPathPrefix, SHOW_FILENAME)
	};
	const supplied = {
		movie: normalizeKometaMetadataReference(input.references.movie, MOVIE_FILENAME),
		show: normalizeKometaMetadataReference(input.references.show, SHOW_FILENAME)
	};
	if (supplied.movie !== expected.movie || supplied.show !== expected.show) {
		throw new TypeError('Kometa migration references do not match the configured prefix');
	}
	return { metadataPathPrefix, references: expected };
}

function ownedMetadataReference(snapshot: KometaSnapshot | null, library: string): string | null {
	const previous = snapshot?.libraries[library];
	if (!previous) return null;
	if (typeof previous.metadataReference === 'string' && previous.metadataReference.length > 0) {
		return previous.metadataReference;
	}
	if (typeof previous.metadataFile === 'string' && previous.metadataFile.length > 0) {
		return previous.metadataFile;
	}
	if (previous.metadata === true && typeof snapshot?.metadataPath === 'string') {
		return snapshot.metadataPath;
	}
	return null;
}

function cloneManagedLibrary(value: ManagedLib): ManagedLib {
	return {
		...value,
		defaults: [...value.defaults],
		overlays: value.overlays ? [...value.overlays] : undefined,
		operations: value.operations ? [...value.operations] : undefined,
		settingsKeys: value.settingsKeys ? [...value.settingsKeys] : undefined
	};
}

function scrubLegacyOwnership(value: ManagedLib, legacyGlobalPath: string | undefined): ManagedLib {
	const {
		metadata: legacyMetadata,
		metadataFile: legacyMetadataFile,
		metadataReference,
		...rest
	} = cloneManagedLibrary(value);
	let retainedReference: string | null = null;
	if (typeof metadataReference === 'string') {
		if (!isLegacyKometaMetadataReference(metadataReference)) retainedReference = metadataReference;
	} else if (typeof legacyMetadataFile === 'string') {
		if (!isLegacyKometaMetadataReference(legacyMetadataFile))
			retainedReference = legacyMetadataFile;
	} else if (
		legacyMetadata === true &&
		legacyGlobalPath &&
		!isLegacyKometaMetadataReference(legacyGlobalPath)
	) {
		retainedReference = legacyGlobalPath;
	}
	return {
		...rest,
		metadataReference: retainedReference
	};
}

function buildNextSnapshot(
	snapshot: KometaSnapshot | null,
	metadataPathPrefix: string,
	typedLibraries: readonly ResolvedLibrary[],
	references: KometaMigrationConfigReferences
): KometaSnapshot {
	const libraries: Record<string, ManagedLib> = Object.create(null);
	for (const [title, managed] of Object.entries(snapshot?.libraries ?? {})) {
		libraries[title] = scrubLegacyOwnership(managed, snapshot?.metadataPath);
	}
	for (const library of typedLibraries) {
		const previous = libraries[library.title];
		libraries[library.title] = {
			...(previous ?? { defaults: [] }),
			metadataReference: references[library.type]
		};
	}
	return {
		metadataPathPrefix,
		libraries,
		managedSettingKeys: [...(snapshot?.managedSettingKeys ?? [])],
		connections: snapshot?.connections
			? Object.fromEntries(
					Object.entries(snapshot.connections).map(([section, keys]) => [section, [...keys]])
				)
			: undefined
	};
}

function buildManualSnippet(
	libraries: readonly ResolvedLibrary[],
	references: KometaMigrationConfigReferences
): string {
	const entries: Record<string, { metadata_files: { file: string }[] }> = Object.create(null);
	for (const library of libraries) {
		entries[library.title] = {
			metadata_files: [{ file: references[library.type] }]
		};
	}
	const guide = stringify({ libraries: entries }, { lineWidth: 0 });
	return [
		'# REFERENCE ONLY — this is not a complete Kometa config.',
		'# In each named library, replace only the metadata_files item whose file basename is',
		`# ${LEGACY_FILENAME} when present; otherwise add the shown typed item once.`,
		'# Keep every other metadata_files item and library setting unchanged.',
		'# Finish with exactly one typed item and no active legacy item for that library.',
		guide
	].join('\n');
}

function buildManualChanges(
	libraries: readonly ResolvedLibrary[],
	references: KometaMigrationConfigReferences,
	legacyLibraries: ReadonlySet<string>
): KometaMigrationConfigLibraryChange[] {
	return libraries.map((library) => ({
		library: library.title,
		mediaKind: library.type,
		before: legacyLibraries.has(library.title) ? [LEGACY_FILENAME] : [],
		after: references[library.type]
	}));
}

/** Path-normalized identity for comparing two legacy references for equality. */
function normalizedLegacyReference(value: string): string {
	return value.trim().replaceAll('\\', '/');
}

function scalarLibraryName(node: unknown): string | null {
	return isScalar(node) && typeof node.value === 'string' && node.value.length > 0
		? node.value
		: null;
}

function typedBasename(value: string): boolean {
	const basename = kometaMetadataReferenceBasename(value);
	return basename === MOVIE_FILENAME || basename === SHOW_FILENAME;
}

function scanMetadataFiles(
	library: string,
	node: YAMLSeq,
	type: KometaMediaKind | null,
	targetReference: string | null,
	reasons: KometaMigrationConfigReason[]
): LibraryScan {
	const legacy: LegacyReference[] = [];
	const typedReferences: string[] = [];
	for (const item of node.items) {
		if (!isMap(item)) {
			reasons.push({ code: 'unsupported_config_shape', library });
			continue;
		}
		const fileNode = item.get('file', true);
		if (fileNode === undefined) continue;
		if (!isScalar(fileNode) || typeof fileNode.value !== 'string') {
			reasons.push({ code: 'unsupported_config_shape', library });
			continue;
		}
		const reference = fileNode.value;
		if (isLegacyKometaMetadataReference(reference)) {
			legacy.push({
				library,
				reference,
				node: fileNode,
				container: node,
				entry: item,
				type,
				targetReference,
				duplicate: false
			});
		} else if (typedBasename(reference)) {
			typedReferences.push(reference);
		}
	}
	return { legacy, typedReferences };
}

function manualPlan(input: {
	sourceFingerprint: string;
	metadataPathPrefix: string;
	references: KometaMigrationConfigReferences;
	resolvedLibraries: ResolvedLibrary[];
	incompatible: KometaMigrationConfigIncompatibility[];
	reasons: KometaMigrationConfigReason[];
	legacyReferenceCount: number;
	manualWiringActionable: boolean;
	legacyLibraries?: ReadonlySet<string>;
	snapshot: KometaSnapshot | null;
}): KometaMigrationConfigPlan {
	return {
		activation: 'manual',
		sourceFingerprint: input.sourceFingerprint,
		proposedContent: null,
		proposedFingerprint: null,
		nextSnapshot: buildNextSnapshot(
			input.snapshot,
			input.metadataPathPrefix,
			input.resolvedLibraries,
			input.references
		),
		changes: buildManualChanges(
			input.resolvedLibraries,
			input.references,
			input.legacyLibraries ?? new Set()
		),
		warnings: ['manual_wiring_required'],
		reasons: dedupeBy(input.reasons, reasonIdentity),
		incompatibleLibraries: dedupeBy(input.incompatible, incompatibilityIdentity),
		entryRemovals: [],
		legacyReferenceCount: input.legacyReferenceCount,
		manualWiringActionable: input.manualWiringActionable,
		manualSnippet: buildManualSnippet(input.resolvedLibraries, input.references)
	};
}

/**
 * Build the config-only portion of the split-layout migration.
 *
 * This function is intentionally pure. It never exposes exact legacy paths in
 * its preview, never guesses a library type, and never returns proposed bytes
 * unless every observed legacy reference can be safely rewritten.
 */
export function planKometaMigrationConfig(
	input: PlanKometaMigrationConfigInput
): KometaMigrationConfigPlan {
	if (input.mode !== 'merge' && input.mode !== 'own') {
		throw new TypeError('Unsupported Kometa configuration mode');
	}
	const { metadataPathPrefix, references } = validateReferences(input);
	const sourceFingerprint = kometaFileFingerprint(input.rawConfig);
	const authoritative = resolveAuthoritativeLibraries(input.libraries);
	const incompatible = [...authoritative.incompatible];
	const reasons: KometaMigrationConfigReason[] = [];
	const bounded = parseBoundedKometaConfig(input.rawConfig, input.configLimits);
	if (!bounded.ok) {
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: [
				{
					code: bounded.code === 'config_yaml_invalid' ? 'invalid_yaml' : 'config_limit_exceeded'
				}
			],
			legacyReferenceCount: 0,
			manualWiringActionable: false,
			snapshot: input.snapshot
		});
	}
	const document = bounded.document;

	const contents = document.contents;
	if (!isYamlNull(contents) && !isMap(contents)) {
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: [{ code: 'unsupported_config_shape' }],
			legacyReferenceCount: 0,
			manualWiringActionable: false,
			snapshot: input.snapshot
		});
	}

	const root = isMap(contents) ? contents : null;
	const librariesNode = root?.get('libraries', true);
	if (root !== null && hasRelevantIndirection(root, librariesNode)) {
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: [{ code: 'yaml_alias_or_anchor' }],
			legacyReferenceCount: 0,
			manualWiringActionable: false,
			snapshot: input.snapshot
		});
	}

	const legacy: LegacyReference[] = [];
	const typedReferencesByLibrary = new Map<string, string[]>();
	if (librariesNode !== undefined && !isYamlNull(librariesNode)) {
		if (!isMap(librariesNode)) {
			reasons.push({ code: 'unsupported_config_shape' });
		} else {
			for (const pair of librariesNode.items) {
				const library = scalarLibraryName(pair.key);
				if (!library) {
					reasons.push({ code: 'unsupported_config_shape' });
					continue;
				}
				if (isYamlNull(pair.value)) continue;
				if (!isMap(pair.value)) {
					reasons.push({ code: 'unsupported_config_shape', library });
					continue;
				}
				const metadataFiles = pair.value.get('metadata_files', true);
				if (metadataFiles === undefined || isYamlNull(metadataFiles)) continue;
				if (!isSeq(metadataFiles)) {
					reasons.push({ code: 'unsupported_config_shape', library });
					continue;
				}

				const authoritativeType = authoritative.byTitle.get(library);
				const type = authoritativeType ?? null;
				const targetReference = type ? references[type] : null;
				const scan = scanMetadataFiles(library, metadataFiles, type, targetReference, reasons);
				legacy.push(...scan.legacy);
				typedReferencesByLibrary.set(library, scan.typedReferences);
			}
		}
	}

	const legacyByLibrary = new Map<string, LegacyReference[]>();
	for (const reference of legacy) {
		const values = legacyByLibrary.get(reference.library) ?? [];
		values.push(reference);
		legacyByLibrary.set(reference.library, values);
	}

	for (const [library, referencesForLibrary] of legacyByLibrary) {
		const authoritativeType = authoritative.byTitle.get(library);
		if (authoritativeType === undefined) {
			reasons.push({ code: 'unknown_library', library });
			incompatible.push({
				library,
				reason: 'unknown_library',
				suggestion: suggestSections(library, authoritative.byTitle.keys())
			});
		} else if (authoritativeType === null) {
			const conflict = authoritative.incompatible.find((entry) => entry.library === library);
			reasons.push({
				code:
					conflict?.reason === 'conflicting_authoritative_types'
						? 'conflicting_authoritative_types'
						: 'unsupported_library_type',
				library
			});
		}
		if ((typedReferencesByLibrary.get(library)?.length ?? 0) > 0) {
			reasons.push({ code: 'typed_reference_conflict', library });
		}
		const owned = input.mode === 'merge' ? ownedMetadataReference(input.snapshot, library) : null;
		if (input.mode === 'merge') {
			const ownedMatches =
				isLegacyKometaMetadataReference(owned) &&
				referencesForLibrary.some((reference) => reference.reference === owned);
			if (!ownedMatches) {
				reasons.push({ code: 'unowned_legacy_reference', library });
			}
		}
		// Every repeat is removed by the rewrite, but consent differs by proof.
		// Identical repeats (equal after path normalization) are provably one
		// file and collapse quietly into the surviving change's before-list. A
		// basename match cannot prove that `first/posterpilot.yml` and
		// `second/posterpilot.yml` are one file, so distinct paths are marked as
		// explicit removals: shown in the preview and gated behind their own
		// acknowledgment at confirmation, never absorbed silently.
		if (referencesForLibrary.length > 1) {
			const expectedLegacy = kometaMetadataReference(metadataPathPrefix, LEGACY_FILENAME);
			const primary =
				(owned ? referencesForLibrary.find((entry) => entry.reference === owned) : undefined) ??
				referencesForLibrary.find(
					(entry) => normalizedLegacyReference(entry.reference) === expectedLegacy
				) ??
				referencesForLibrary[0];
			const primaryIdentity = normalizedLegacyReference(primary.reference);
			for (const entry of referencesForLibrary) {
				if (entry === primary) continue;
				entry.duplicate =
					normalizedLegacyReference(entry.reference) === primaryIdentity ? 'identical' : 'distinct';
			}
		}
	}

	if (authoritative.resolved.length === 0) {
		reasons.push({ code: 'no_authoritative_libraries' });
	}
	for (const library of authoritative.resolved) {
		const legacyReferences = legacyByLibrary.get(library.title) ?? [];
		if (legacyReferences.length > 0) continue;
		const typedReferences = typedReferencesByLibrary.get(library.title) ?? [];
		const expectedReference = references[library.type];
		if (typedReferences.length === 0) {
			reasons.push({ code: 'missing_typed_reference', library: library.title });
		} else if (typedReferences.length !== 1 || typedReferences[0] !== expectedReference) {
			reasons.push({ code: 'typed_reference_conflict', library: library.title });
		}
	}
	for (const value of authoritative.incompatible) {
		reasons.push({ code: value.reason, library: value.library });
	}

	const uniqueReasons = dedupeBy(reasons, reasonIdentity);
	if (uniqueReasons.length > 0) {
		const structurallyIndeterminate = uniqueReasons.some(
			(reason) => reason.code === 'unsupported_config_shape'
		);
		const unresolvedLegacyReference = legacy.some(
			(reference) => reference.type === null || reference.targetReference === null
		);
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: uniqueReasons,
			legacyReferenceCount: legacy.length,
			manualWiringActionable:
				authoritative.resolved.length > 0 &&
				!structurallyIndeterminate &&
				!unresolvedLegacyReference,
			legacyLibraries: new Set(legacy.map((reference) => reference.library)),
			snapshot: input.snapshot
		});
	}

	const changes: KometaMigrationConfigLibraryChange[] = [];
	const entryRemovals: KometaMigrationConfigEntryRemoval[] = [];
	const identicalRepeatsByLibrary = new Map<string, number>();
	for (const reference of legacy) {
		if (reference.duplicate === 'identical') {
			identicalRepeatsByLibrary.set(
				reference.library,
				(identicalRepeatsByLibrary.get(reference.library) ?? 0) + 1
			);
		}
	}
	for (const reference of legacy) {
		if (!reference.type || !reference.targetReference) {
			throw new TypeError('Validated Kometa migration reference lost its authoritative type');
		}
		if (reference.duplicate) {
			// Rewriting a repeat too would leave two identical typed entries, so it
			// is removed. Identical repeats surface on the surviving change's
			// before-list; distinct paths surface as acknowledged removals.
			const index = reference.container.items.indexOf(reference.entry);
			if (index >= 0) reference.container.items.splice(index, 1);
			if (reference.duplicate === 'distinct') {
				entryRemovals.push({ library: reference.library, reference: reference.reference });
			}
			continue;
		}
		reference.node.value = reference.targetReference;
		changes.push({
			library: reference.library,
			mediaKind: reference.type,
			// One entry per identical repeat consumed, so the frozen preview shows
			// the collapse, not just the surviving rewrite.
			before: Array.from(
				{ length: 1 + (identicalRepeatsByLibrary.get(reference.library) ?? 0) },
				() => LEGACY_FILENAME
			),
			after: reference.targetReference
		});
	}

	const proposedContent = legacy.length === 0 ? input.rawConfig : document.toString();
	return {
		activation: 'managed',
		sourceFingerprint,
		proposedContent,
		proposedFingerprint: kometaFileFingerprint(proposedContent),
		nextSnapshot: buildNextSnapshot(
			input.snapshot,
			metadataPathPrefix,
			authoritative.resolved,
			references
		),
		changes,
		warnings: legacy.length === 0 ? ['no_legacy_references'] : [],
		reasons: [],
		incompatibleLibraries: dedupeBy(incompatible, incompatibilityIdentity),
		entryRemovals,
		legacyReferenceCount: legacy.length,
		manualWiringActionable: true,
		manualSnippet: null
	};
}

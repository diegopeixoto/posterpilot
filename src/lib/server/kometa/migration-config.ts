import type { KometaConfigMode } from '$lib/server/config';
import { isAlias, isMap, isScalar, isSeq, stringify, type Scalar, type YAMLSeq } from 'yaml';
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
	| 'duplicate_legacy_reference'
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
}

/** Public preview entry. The legacy path is reduced to its non-sensitive basename. */
export interface KometaMigrationConfigLibraryChange {
	library: string;
	mediaKind: KometaMediaKind;
	/** Redacted basenames only; an empty list means the current safe shape is unknown/absent. */
	before: (typeof LEGACY_FILENAME | typeof MOVIE_FILENAME | typeof SHOW_FILENAME)[];
	after: string;
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
	legacyReferenceCount: number;
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
	type: KometaMediaKind | null;
	targetReference: string | null;
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

function hasAliasOrAnchor(node: unknown): boolean {
	if (isAlias(node)) return true;
	if (isScalar(node)) return Boolean(node.anchor);
	if (isMap(node)) {
		if (node.anchor) return true;
		return node.items.some((pair) => hasAliasOrAnchor(pair.key) || hasAliasOrAnchor(pair.value));
	}
	if (isSeq(node)) {
		if (node.anchor) return true;
		return node.items.some((item) => hasAliasOrAnchor(item));
	}
	return false;
}

function resolveAuthoritativeLibraries(libraries: readonly AuthoritativeKometaLibrary[]): {
	resolved: ResolvedLibrary[];
	byTitle: Map<string, KometaMediaKind | null>;
	incompatible: KometaMigrationConfigIncompatibility[];
} {
	const typesByTitle = new Map<string, Set<string>>();
	const order: string[] = [];
	for (const library of libraries) {
		if (typeof library.title !== 'string' || library.title.length === 0) {
			throw new TypeError('Authoritative Kometa library title must be non-empty');
		}
		if (!typesByTitle.has(library.title)) {
			typesByTitle.set(library.title, new Set());
			order.push(library.title);
		}
		typesByTitle.get(library.title)?.add(library.type);
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
	const libraries: Record<string, ManagedLib> = {};
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
			legacy.push({ library, reference, node: fileNode, type, targetReference });
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
		legacyReferenceCount: input.legacyReferenceCount,
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
			snapshot: input.snapshot
		});
	}
	const document = bounded.document;

	const contents = document.contents;
	if (contents !== null && !isMap(contents)) {
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: [{ code: 'unsupported_config_shape' }],
			legacyReferenceCount: 0,
			snapshot: input.snapshot
		});
	}

	const librariesNode = contents?.get('libraries', true);
	const aliasScope = input.mode === 'own' ? contents : librariesNode;
	if (aliasScope !== undefined && aliasScope !== null && hasAliasOrAnchor(aliasScope)) {
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: [{ code: 'yaml_alias_or_anchor' }],
			legacyReferenceCount: 0,
			snapshot: input.snapshot
		});
	}

	const legacy: LegacyReference[] = [];
	const typedReferencesByLibrary = new Map<string, string[]>();
	if (librariesNode !== undefined && librariesNode !== null) {
		if (!isMap(librariesNode)) {
			reasons.push({ code: 'unsupported_config_shape' });
		} else {
			for (const pair of librariesNode.items) {
				const library = scalarLibraryName(pair.key);
				if (!library) {
					reasons.push({ code: 'unsupported_config_shape' });
					continue;
				}
				if (!isMap(pair.value)) {
					reasons.push({ code: 'unsupported_config_shape', library });
					continue;
				}
				const metadataFiles = pair.value.get('metadata_files', true);
				if (metadataFiles === undefined || metadataFiles === null) continue;
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
			incompatible.push({ library, reason: 'unknown_library' });
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
		if (referencesForLibrary.length !== 1) {
			reasons.push({ code: 'duplicate_legacy_reference', library });
		}
		if ((typedReferencesByLibrary.get(library)?.length ?? 0) > 0) {
			reasons.push({ code: 'typed_reference_conflict', library });
		}
		if (input.mode === 'merge') {
			const owned = ownedMetadataReference(input.snapshot, library);
			if (
				referencesForLibrary.length !== 1 ||
				!isLegacyKometaMetadataReference(owned) ||
				owned !== referencesForLibrary[0].reference
			) {
				reasons.push({ code: 'unowned_legacy_reference', library });
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
		return manualPlan({
			sourceFingerprint,
			metadataPathPrefix,
			references,
			resolvedLibraries: authoritative.resolved,
			incompatible,
			reasons: uniqueReasons,
			legacyReferenceCount: legacy.length,
			legacyLibraries: new Set(legacy.map((reference) => reference.library)),
			snapshot: input.snapshot
		});
	}

	const changes: KometaMigrationConfigLibraryChange[] = [];
	for (const reference of legacy) {
		if (!reference.type || !reference.targetReference) {
			throw new TypeError('Validated Kometa migration reference lost its authoritative type');
		}
		reference.node.value = reference.targetReference;
		changes.push({
			library: reference.library,
			mediaKind: reference.type,
			before: [LEGACY_FILENAME],
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
		legacyReferenceCount: legacy.length,
		manualSnippet: null
	};
}

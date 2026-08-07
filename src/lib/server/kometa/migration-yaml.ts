import {
	Document,
	isAlias,
	isMap,
	isNode,
	isScalar,
	isSeq,
	parseDocument,
	type Node,
	type Pair,
	type YAMLMap
} from 'yaml';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import {
	MOVIE_FILENAME,
	SHOW_FILENAME,
	isKometaDestinationV2,
	kometaYamlMappingKey,
	type KometaDestinationV2,
	type KometaMetadataFilename
} from './destination';
import {
	compareCodeUnitStrings,
	migrationYamlNodeFingerprint,
	parseLegacyMetadata,
	type LegacyEntryClassificationResult,
	type LegacyMetadataLimitOverrides,
	type ParsedLegacyMetadata
} from './migration-classifier';

const SHA256 = /^[0-9a-f]{64}$/;

const MIGRATION_YAML_LIMITS = Object.freeze({
	maxTargetBytes: 8 * 1024 * 1024,
	maxOutputBytes: 16 * 1024 * 1024,
	maxOperations: 20_000,
	maxNodes: 250_000,
	maxDepth: 32,
	maxScalarBytes: 64 * 1024
});

export type MigrationYamlLimitName = keyof typeof MIGRATION_YAML_LIMITS;
export type MigrationYamlLimitOverrides = Partial<Record<MigrationYamlLimitName, number>>;

export type MigrationYamlBuildErrorCode =
	| 'migration_classification_stale'
	| 'migration_classification_invalid'
	| 'typed_target_too_large'
	| 'typed_target_yaml_invalid'
	| 'typed_target_not_mapping'
	| 'typed_target_metadata_not_mapping'
	| 'typed_target_alias_or_anchor_unsupported'
	| 'typed_target_node_limit_exceeded'
	| 'typed_target_depth_limit_exceeded'
	| 'typed_target_scalar_limit_exceeded'
	| 'migration_operation_limit_exceeded'
	| 'migration_output_invalid'
	| 'migration_output_too_large';

/** Locale-neutral and content-redacted migration builder failure. */
export class MigrationYamlBuildError extends Error {
	constructor(readonly code: MigrationYamlBuildErrorCode) {
		super(code);
		this.name = 'MigrationYamlBuildError';
	}
}

export interface RedactedMigrationYamlChange {
	operation: 'add' | 'unchanged' | 'normalize_key';
	sourceIndexes: number[];
	legacyMappingIds: string[];
	destinationKey: string;
	filename: KometaMetadataFilename;
	/** Structural identifier only; numeric namespaces are rendered canonically. */
	targetMappingId: string;
	entryFingerprint: string;
	targetFingerprint: string | null;
	path: string;
}

export interface MigrationYamlTargetConflict {
	reason: 'typed_target_conflict';
	sourceIndexes: number[];
	legacyMappingIds: string[];
	destination: KometaDestinationV2;
	entryFingerprint: string;
	targetFingerprint: string | null;
	path: string;
}

export interface BuiltMigrationYamlFile {
	filename: KometaMetadataFilename;
	sourceFingerprint: string;
	proposedFingerprint: string;
	/** Exact server-side bytes. Public previews must use `diff`, never this field. */
	proposedContent: string;
	changed: boolean;
	added: number;
	unchanged: number;
	normalizedKeys: number;
	/** URL-free structural operations and fingerprints only. */
	diff: RedactedMigrationYamlChange[];
}

export interface BuiltSplitMigrationYaml {
	legacySourceFingerprint: string;
	evidenceFingerprint: string;
	files: {
		movie: BuiltMigrationYamlFile;
		show: BuiltMigrationYamlFile;
	};
	conflicts: MigrationYamlTargetConflict[];
}

export interface BuildSplitMigrationYamlInput {
	legacyRaw: string;
	movieRaw: string | null;
	showRaw: string | null;
	classification: LegacyEntryClassificationResult;
	legacyLimits?: LegacyMetadataLimitOverrides;
	limits?: MigrationYamlLimitOverrides;
}

type EffectiveLimits = typeof MIGRATION_YAML_LIMITS;

interface TypedDocument {
	document: Document<Node>;
	metadata: YAMLMap;
	sourceRaw: string | null;
	filename: KometaMetadataFilename;
	diff: RedactedMigrationYamlChange[];
	added: number;
	unchanged: number;
	normalizedKeys: number;
}

interface SourceEntry {
	sourceIndex: number;
	legacyMappingId: string;
	entryFingerprint: string;
	pair: Pair;
	destination: KometaDestinationV2;
}

interface DestinationGroup {
	destination: KometaDestinationV2;
	sources: SourceEntry[];
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function effectiveLimits(overrides: MigrationYamlLimitOverrides = {}): EffectiveLimits {
	const limits: Record<MigrationYamlLimitName, number> = { ...MIGRATION_YAML_LIMITS };
	for (const name of Object.keys(MIGRATION_YAML_LIMITS) as MigrationYamlLimitName[]) {
		const value = overrides[name];
		if (value === undefined) continue;
		if (!Number.isSafeInteger(value) || value < 1 || value > MIGRATION_YAML_LIMITS[name]) {
			throw new RangeError(`Invalid lowered migration YAML limit: ${name}`);
		}
		limits[name] = value;
	}
	return limits as EffectiveLimits;
}

function fileFingerprint(raw: string | null): string {
	return hashCanonicalJson({ exists: raw !== null, content: raw });
}

function keyValue(key: unknown): unknown {
	return isScalar(key) ? key.value : key;
}

function nodeHasAnchor(node: Node): boolean {
	return typeof (node as Node & { anchor?: unknown }).anchor === 'string';
}

function assertBoundedTree(document: Document<Node>, limits: EffectiveLimits): void {
	if (!document.contents) return;
	let count = 0;
	const stack: { node: Node; depth: number }[] = [{ node: document.contents, depth: 1 }];
	while (stack.length > 0) {
		const current = stack.pop()!;
		count += 1;
		if (count > limits.maxNodes) {
			throw new MigrationYamlBuildError('typed_target_node_limit_exceeded');
		}
		if (current.depth > limits.maxDepth) {
			throw new MigrationYamlBuildError('typed_target_depth_limit_exceeded');
		}
		if (isAlias(current.node) || nodeHasAnchor(current.node)) {
			throw new MigrationYamlBuildError('typed_target_alias_or_anchor_unsupported');
		}
		if (isScalar(current.node)) {
			if (utf8Bytes(String(current.node.value ?? '')) > limits.maxScalarBytes) {
				throw new MigrationYamlBuildError('typed_target_scalar_limit_exceeded');
			}
			continue;
		}
		if (isMap(current.node)) {
			for (const pair of current.node.items) {
				if (isNode(pair.key)) stack.push({ node: pair.key, depth: current.depth + 1 });
				if (isNode(pair.value)) stack.push({ node: pair.value, depth: current.depth + 1 });
			}
			continue;
		}
		if (isSeq(current.node)) {
			for (const item of current.node.items) {
				if (isNode(item)) stack.push({ node: item, depth: current.depth + 1 });
			}
		}
	}
}

function copyPresentation(source: unknown, target: unknown): void {
	if (!isNode(source) || !isNode(target)) return;
	target.comment = source.comment;
	target.commentBefore = source.commentBefore;
	target.spaceBefore = source.spaceBefore;
}

function newMap(document: Document<Node>): YAMLMap {
	return document.createNode({}) as YAMLMap;
}

function metadataPairs(root: YAMLMap): Pair[] {
	return root.items.filter((pair) => keyValue(pair.key) === 'metadata');
}

function parseTypedDocument(
	raw: string | null,
	filename: KometaMetadataFilename,
	limits: EffectiveLimits
): TypedDocument {
	if (raw !== null && utf8Bytes(raw) > limits.maxTargetBytes) {
		throw new MigrationYamlBuildError('typed_target_too_large');
	}
	const parsed = parseDocument(raw ?? '', { uniqueKeys: true });
	if (parsed.errors.length > 0) {
		throw new MigrationYamlBuildError('typed_target_yaml_invalid');
	}
	const document = parsed as unknown as Document<Node>;
	assertBoundedTree(document, limits);

	if (document.contents === null) document.contents = newMap(document);
	if (!isMap(document.contents)) {
		throw new MigrationYamlBuildError('typed_target_not_mapping');
	}
	const pairs = metadataPairs(document.contents);
	let metadata: YAMLMap;
	if (pairs.length === 0) {
		metadata = newMap(document);
		document.contents.items.push(document.createPair('metadata', metadata));
	} else if (pairs.length === 1 && isMap(pairs[0].value)) {
		metadata = pairs[0].value;
	} else {
		throw new MigrationYamlBuildError('typed_target_metadata_not_mapping');
	}

	return {
		document,
		metadata,
		sourceRaw: raw,
		filename,
		diff: [],
		added: 0,
		unchanged: 0,
		normalizedKeys: 0
	};
}

function findLogicalPairs(metadata: YAMLMap, mappingKey: string | number): Pair[] {
	return metadata.items.filter((pair) => String(keyValue(pair.key)) === String(mappingKey));
}

function exactKeyType(pair: Pair, mappingKey: string | number): boolean {
	const current = keyValue(pair.key);
	return current === mappingKey && typeof current === typeof mappingKey;
}

function normalizePairKey(document: Document<Node>, pair: Pair, mappingKey: string | number): void {
	const replacement = document.createNode(mappingKey);
	copyPresentation(pair.key, replacement);
	pair.key = replacement;
}

function cloneRekeyedPair(
	document: Document<Node>,
	source: Pair,
	mappingKey: string | number
): Pair {
	const cloned = source.clone(document.schema);
	const replacement = document.createNode(mappingKey);
	copyPresentation(cloned.key, replacement);
	cloned.key = replacement;
	return cloned;
}

function structuralPath(mappingKey: string | number): string {
	return `metadata[${String(mappingKey)}]`;
}

function redactedChange(
	operation: RedactedMigrationYamlChange['operation'],
	group: DestinationGroup,
	targetFingerprint: string | null
): RedactedMigrationYamlChange {
	const mappingKey = kometaYamlMappingKey(group.destination);
	return {
		operation,
		sourceIndexes: group.sources.map((source) => source.sourceIndex),
		legacyMappingIds: group.sources.map((source) => source.legacyMappingId),
		destinationKey: group.destination.key,
		filename: group.destination.filename,
		targetMappingId: group.destination.mappingId,
		entryFingerprint: group.sources[0].entryFingerprint,
		targetFingerprint,
		path: structuralPath(mappingKey)
	};
}

function conflict(
	group: DestinationGroup,
	targetFingerprint: string | null
): MigrationYamlTargetConflict {
	return {
		reason: 'typed_target_conflict',
		sourceIndexes: group.sources.map((source) => source.sourceIndex),
		legacyMappingIds: group.sources.map((source) => source.legacyMappingId),
		destination: group.destination,
		entryFingerprint: group.sources[0].entryFingerprint,
		targetFingerprint,
		path: structuralPath(kometaYamlMappingKey(group.destination))
	};
}

function applyGroup(
	target: TypedDocument,
	group: DestinationGroup
): MigrationYamlTargetConflict | null {
	const sourceFingerprints = new Set(group.sources.map((source) => source.entryFingerprint));
	if (sourceFingerprints.size !== 1) return conflict(group, null);

	const mappingKey = kometaYamlMappingKey(group.destination);
	const existingPairs = findLogicalPairs(target.metadata, mappingKey);
	if (existingPairs.length > 1) {
		return conflict(group, null);
	}
	if (existingPairs.length === 1) {
		const existing = existingPairs[0];
		const targetFingerprint = migrationYamlNodeFingerprint(existing.value);
		if (targetFingerprint !== group.sources[0].entryFingerprint) {
			return conflict(group, targetFingerprint);
		}
		if (exactKeyType(existing, mappingKey)) {
			target.unchanged += 1;
			target.diff.push(redactedChange('unchanged', group, targetFingerprint));
		} else {
			normalizePairKey(target.document, existing, mappingKey);
			target.normalizedKeys += 1;
			target.diff.push(redactedChange('normalize_key', group, targetFingerprint));
		}
		return null;
	}

	const cloned = cloneRekeyedPair(target.document, group.sources[0].pair, mappingKey);
	if (migrationYamlNodeFingerprint(cloned.value) !== group.sources[0].entryFingerprint) {
		throw new MigrationYamlBuildError('migration_classification_stale');
	}
	target.metadata.items.push(cloned);
	target.added += 1;
	target.diff.push(redactedChange('add', group, null));
	return null;
}

function finalizeFile(target: TypedDocument, limits: EffectiveLimits): BuiltMigrationYamlFile {
	let proposedContent: string;
	try {
		proposedContent = target.document.toString();
	} catch {
		throw new MigrationYamlBuildError('migration_output_invalid');
	}
	if (utf8Bytes(proposedContent) > limits.maxOutputBytes) {
		throw new MigrationYamlBuildError('migration_output_too_large');
	}
	return {
		filename: target.filename,
		sourceFingerprint: fileFingerprint(target.sourceRaw),
		proposedFingerprint: fileFingerprint(proposedContent),
		proposedContent,
		changed: proposedContent !== target.sourceRaw,
		added: target.added,
		unchanged: target.unchanged,
		normalizedKeys: target.normalizedKeys,
		diff: target.diff
	};
}

function checkedSourceEntries(
	input: BuildSplitMigrationYamlInput,
	legacyDocument: Document<Node>,
	parsed: ParsedLegacyMetadata
): SourceEntry[] {
	if (!isMap(legacyDocument.contents)) {
		if (input.classification.classified.length === 0) return [];
		throw new MigrationYamlBuildError('migration_classification_stale');
	}
	const roots = metadataPairs(legacyDocument.contents);
	if (roots.length !== 1 || !isMap(roots[0].value)) {
		if (input.classification.classified.length === 0) return [];
		throw new MigrationYamlBuildError('migration_classification_stale');
	}
	const metadata = roots[0].value;
	const parsedByIndex = new Map(parsed.entries.map((entry) => [entry.sourceIndex, entry]));
	const seen = new Set<number>();
	const sources: SourceEntry[] = [];
	for (const classified of input.classification.classified) {
		if (
			seen.has(classified.sourceIndex) ||
			!Number.isSafeInteger(classified.sourceIndex) ||
			classified.sourceIndex < 0 ||
			!isKometaDestinationV2(classified.destination)
		) {
			throw new MigrationYamlBuildError('migration_classification_invalid');
		}
		seen.add(classified.sourceIndex);
		const parsedEntry = parsedByIndex.get(classified.sourceIndex);
		const pair = metadata.items[classified.sourceIndex];
		if (
			!parsedEntry ||
			!pair ||
			parsedEntry.shapeIssues.length > 0 ||
			parsedEntry.legacyMappingId !== classified.legacyMappingId ||
			parsedEntry.entryFingerprint !== classified.entryFingerprint ||
			migrationYamlNodeFingerprint(pair.value) !== classified.entryFingerprint
		) {
			throw new MigrationYamlBuildError('migration_classification_stale');
		}
		sources.push({
			sourceIndex: classified.sourceIndex,
			legacyMappingId: classified.legacyMappingId,
			entryFingerprint: classified.entryFingerprint,
			pair,
			destination: classified.destination
		});
	}
	return sources;
}

function destinationGroups(sources: SourceEntry[]): DestinationGroup[] {
	const groups = new Map<string, DestinationGroup>();
	for (const source of sources) {
		const current = groups.get(source.destination.key) ?? {
			destination: source.destination,
			sources: []
		};
		current.sources.push(source);
		groups.set(source.destination.key, current);
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			sources: group.sources.sort((left, right) => left.sourceIndex - right.sourceIndex)
		}))
		.sort(
			(left, right) =>
				left.sources[0].sourceIndex - right.sources[0].sourceIndex ||
				compareCodeUnitStrings(left.destination.key, right.destination.key)
		);
}

/**
 * Build exact split-file bytes from a frozen pure classification.
 *
 * Existing identical entries are retained, conflicts are never overwritten,
 * and all public-facing operations are structural fingerprints without URLs.
 */
export function buildSplitMigrationYaml(
	input: BuildSplitMigrationYamlInput
): BuiltSplitMigrationYaml {
	const limits = effectiveLimits(input.limits);
	if (input.classification.classified.length > limits.maxOperations) {
		throw new MigrationYamlBuildError('migration_operation_limit_exceeded');
	}
	const parsed = parseLegacyMetadata(input.legacyRaw, input.legacyLimits);
	if (
		parsed.sourceFingerprint !== input.classification.sourceFingerprint ||
		!SHA256.test(input.classification.evidenceFingerprint)
	) {
		throw new MigrationYamlBuildError('migration_classification_stale');
	}

	const legacyParsed = parseDocument(input.legacyRaw, { uniqueKeys: true });
	if (legacyParsed.errors.length > 0) {
		throw new MigrationYamlBuildError('migration_classification_stale');
	}
	const legacyDocument = legacyParsed as unknown as Document<Node>;
	const sources = checkedSourceEntries(input, legacyDocument, parsed);
	const movie = parseTypedDocument(input.movieRaw, MOVIE_FILENAME, limits);
	const show = parseTypedDocument(input.showRaw, SHOW_FILENAME, limits);
	const conflicts: MigrationYamlTargetConflict[] = [];

	for (const group of destinationGroups(sources)) {
		const target = group.destination.filename === MOVIE_FILENAME ? movie : show;
		const collision = applyGroup(target, group);
		if (collision) conflicts.push(collision);
	}

	return {
		legacySourceFingerprint: parsed.sourceFingerprint,
		evidenceFingerprint: input.classification.evidenceFingerprint,
		files: {
			movie: finalizeFile(movie, limits),
			show: finalizeFile(show, limits)
		},
		conflicts
	};
}

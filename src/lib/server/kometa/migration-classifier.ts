import {
	isAlias,
	isMap,
	isNode,
	isScalar,
	isSeq,
	parseDocument,
	type Document,
	type Node,
	type Pair,
	type YAMLMap
} from 'yaml';
import { applySlotKey, type ApplySlot } from '$lib/server/plans/apply-plan';
import { canonicalJson, hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { kometaSlotFingerprint } from '$lib/server/revisions/kometa-state';
import {
	isCanonicalKometaNumericId,
	resolveKometaDestination,
	type KometaDestinationV2,
	type KometaMediaKind
} from './destination';

const SHA256 = /^[0-9a-f]{64}$/;
const YAML_INDEX = /^(0|[1-9]\d*)$/;

/** Hard ceilings for untrusted legacy metadata. Overrides may only lower them. */
export const LEGACY_METADATA_LIMITS = Object.freeze({
	maxBytes: 8 * 1024 * 1024,
	maxEntries: 20_000,
	maxManagedLeaves: 100_000,
	maxNodes: 250_000,
	maxDepth: 32,
	maxScalarBytes: 64 * 1024,
	maxMappings: 100_000,
	maxRevisionEvidence: 200_000
});

export type LegacyMetadataLimitName = keyof typeof LEGACY_METADATA_LIMITS;
export type LegacyMetadataLimitOverrides = Partial<Record<LegacyMetadataLimitName, number>>;

export type LegacyMetadataParseErrorCode =
	| 'legacy_source_too_large'
	| 'legacy_yaml_invalid'
	| 'legacy_document_not_mapping'
	| 'legacy_metadata_not_mapping'
	| 'legacy_alias_or_anchor_unsupported'
	| 'legacy_node_limit_exceeded'
	| 'legacy_depth_limit_exceeded'
	| 'legacy_scalar_limit_exceeded'
	| 'legacy_entry_limit_exceeded'
	| 'legacy_leaf_limit_exceeded';

/** Locale-neutral and source-redacted parser failure. */
export class LegacyMetadataParseError extends Error {
	constructor(readonly code: LegacyMetadataParseErrorCode) {
		super(code);
		this.name = 'LegacyMetadataParseError';
	}
}

export type LegacyEntryShapeIssueCode =
	| 'unsupported_legacy_key'
	| 'duplicate_legacy_key'
	| 'entry_not_mapping'
	| 'managed_container_not_mapping'
	| 'managed_index_not_integer'
	| 'duplicate_managed_index'
	| 'managed_leaf_not_string';

export interface LegacyEntryShapeIssue {
	code: LegacyEntryShapeIssueCode;
	/** Structural path only. Values and URLs are never copied here. */
	path: string;
}

export interface LegacyManagedLeaf {
	slot: ApplySlot;
	slotKey: string;
	/** Fingerprint of `{ state: 'present', url }`; the URL itself is not retained. */
	fingerprint: string;
}

export interface ParsedLegacyMetadataEntry {
	sourceIndex: number;
	/** Canonical legacy TMDB key, or null when the key is unsupported. */
	legacyMappingId: string | null;
	/** Numeric key or a fingerprint-derived placeholder; never an untrusted raw key. */
	displayKey: string;
	keyFingerprint: string;
	entryFingerprint: string;
	leaves: LegacyManagedLeaf[];
	shapeIssues: LegacyEntryShapeIssue[];
}

export interface ParsedLegacyMetadata {
	/** Exact existing-file fingerprint compatible with `kometaFileFingerprint(raw)`. */
	sourceFingerprint: string;
	entries: ParsedLegacyMetadataEntry[];
}

export interface AuthoritativeKometaMapping {
	mediaItemId: number;
	type: KometaMediaKind;
	tmdbId: string | null;
	tvdbId: string | null;
	imdbId: string | null;
}

/**
 * Exact historical V1 evidence normalized by the impure repository layer.
 *
 * Callers must supply only successful exact legacy-Kometa revisions whose
 * recorded destination proves `posterpilot.yml` plus `legacyMappingId`.
 * The classifier still requires the current authoritative item record and an
 * exact proposed-fingerprint match for the current leaf.
 */
export interface NormalizedLegacyRevisionEvidence {
	revisionId: string;
	mediaItemId: number;
	legacyMappingId: string;
	slot: ApplySlot;
	proposedFingerprint: string;
}

export type LegacyMigrationAmbiguityReason =
	| 'unsupported_legacy_key'
	| 'unsupported_entry_shape'
	| 'no_authoritative_mapping'
	| 'missing_typed_identifier'
	| 'multiple_typed_destinations'
	| 'mixed_slot_provenance'
	| 'revision_no_longer_matches';

export interface ClassifiedLegacyMetadataEntry {
	sourceIndex: number;
	legacyMappingId: string;
	displayKey: string;
	entryFingerprint: string;
	slots: string[];
	destination: KometaDestinationV2;
	evidence: 'mapping' | 'revision';
}

export interface AmbiguousLegacyMetadataEntry {
	sourceIndex: number;
	legacyMappingId: string | null;
	displayKey: string;
	entryFingerprint: string;
	slots: string[];
	reason: LegacyMigrationAmbiguityReason;
}

export interface LegacyEntryClassificationResult {
	sourceFingerprint: string;
	/** Covers source bytes plus normalized authoritative and revision evidence. */
	evidenceFingerprint: string;
	classified: ClassifiedLegacyMetadataEntry[];
	ambiguous: AmbiguousLegacyMetadataEntry[];
}

export interface ClassifyLegacyEntriesInput {
	parsed: ParsedLegacyMetadata;
	/** Active items only; these mappings may classify a legacy key directly. */
	mappings: AuthoritativeKometaMapping[];
	/**
	 * Current or tombstoned item identities attached to accepted V1 revisions.
	 * They may resolve exact revision provenance, but never classify a key directly.
	 */
	revisionMappings?: AuthoritativeKometaMapping[];
	revisions: NormalizedLegacyRevisionEvidence[];
	limits?: LegacyMetadataLimitOverrides;
}

type EffectiveLimits = typeof LEGACY_METADATA_LIMITS;

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/** Deterministic UTF-16 code-unit ordering; never varies with host locale or normalization. */
export function compareCodeUnitStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function effectiveLimits(overrides: LegacyMetadataLimitOverrides = {}): EffectiveLimits {
	const limits: Record<LegacyMetadataLimitName, number> = { ...LEGACY_METADATA_LIMITS };
	for (const name of Object.keys(LEGACY_METADATA_LIMITS) as LegacyMetadataLimitName[]) {
		const value = overrides[name];
		if (value === undefined) continue;
		if (!Number.isSafeInteger(value) || value < 1 || value > LEGACY_METADATA_LIMITS[name]) {
			throw new RangeError(`Invalid lowered migration limit: ${name}`);
		}
		limits[name] = value;
	}
	return limits as EffectiveLimits;
}

function keyValue(key: unknown): unknown {
	return isScalar(key) ? key.value : key;
}

function nodeHasAnchor(node: Node): boolean {
	return typeof (node as Node & { anchor?: unknown }).anchor === 'string';
}

function boundedDocument(raw: string, limits: EffectiveLimits): Document<Node> {
	if (utf8Bytes(raw) > limits.maxBytes) {
		throw new LegacyMetadataParseError('legacy_source_too_large');
	}

	const parsed = parseDocument(raw, { uniqueKeys: true });
	if (parsed.errors.length > 0) throw new LegacyMetadataParseError('legacy_yaml_invalid');
	const document = parsed as unknown as Document<Node>;
	if (!document.contents) return document;

	let nodes = 0;
	const stack: { node: Node; depth: number }[] = [{ node: document.contents, depth: 1 }];
	while (stack.length > 0) {
		const current = stack.pop()!;
		nodes += 1;
		if (nodes > limits.maxNodes) {
			throw new LegacyMetadataParseError('legacy_node_limit_exceeded');
		}
		if (current.depth > limits.maxDepth) {
			throw new LegacyMetadataParseError('legacy_depth_limit_exceeded');
		}
		if (isAlias(current.node) || nodeHasAnchor(current.node)) {
			throw new LegacyMetadataParseError('legacy_alias_or_anchor_unsupported');
		}
		if (isScalar(current.node)) {
			if (utf8Bytes(String(current.node.value ?? '')) > limits.maxScalarBytes) {
				throw new LegacyMetadataParseError('legacy_scalar_limit_exceeded');
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
	return document;
}

type CanonicalYamlValue =
	| { kind: 'null' }
	| { kind: 'scalar'; type: string; value: string }
	| { kind: 'sequence'; items: CanonicalYamlValue[] }
	| { kind: 'mapping'; entries: { key: CanonicalYamlValue; value: CanonicalYamlValue }[] };

function canonicalScalar(value: unknown): CanonicalYamlValue {
	if (value === null || value === undefined) return { kind: 'null' };
	if (typeof value === 'number') {
		return { kind: 'scalar', type: 'number', value: Object.is(value, -0) ? '0' : String(value) };
	}
	if (typeof value === 'bigint') {
		return { kind: 'scalar', type: 'bigint', value: value.toString() };
	}
	return { kind: 'scalar', type: typeof value, value: String(value) };
}

function canonicalYamlValue(value: unknown): CanonicalYamlValue {
	if (value === null || value === undefined) return { kind: 'null' };
	if (!isNode(value)) return canonicalScalar(value);
	if (isAlias(value) || nodeHasAnchor(value)) {
		throw new LegacyMetadataParseError('legacy_alias_or_anchor_unsupported');
	}
	if (isScalar(value)) return canonicalScalar(value.value);
	if (isSeq(value)) {
		return { kind: 'sequence', items: value.items.map((item) => canonicalYamlValue(item)) };
	}
	if (isMap(value)) {
		const entries = value.items.map((pair) => ({
			key: canonicalYamlValue(pair.key),
			value: canonicalYamlValue(pair.value)
		}));
		entries.sort((left, right) => {
			const leftKey = canonicalJson(left.key);
			const rightKey = canonicalJson(right.key);
			return (
				compareCodeUnitStrings(leftKey, rightKey) ||
				compareCodeUnitStrings(canonicalJson(left.value), canonicalJson(right.value))
			);
		});
		return { kind: 'mapping', entries };
	}
	throw new TypeError('Unsupported YAML node');
}

/** Semantic, comment-insensitive fingerprint shared by parsing and AST migration. */
export function migrationYamlNodeFingerprint(value: unknown): string {
	return hashCanonicalJson(canonicalYamlValue(value));
}

function findPairs(map: YAMLMap, key: string): Pair[] {
	return map.items.filter((pair) => keyValue(pair.key) === key);
}

function normalizeYamlIndex(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value >= 0 ? value : null;
	}
	if (typeof value !== 'string' || !YAML_INDEX.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 && String(parsed) === value ? parsed : null;
}

function normalizeLegacyMappingId(value: unknown): string | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
	}
	return isCanonicalKometaNumericId(value) ? value : null;
}

interface LeafCollector {
	leaves: LegacyManagedLeaf[];
	issues: LegacyEntryShapeIssue[];
	limits: EffectiveLimits;
}

function addIssue(collector: LeafCollector, code: LegacyEntryShapeIssueCode, path: string): void {
	collector.issues.push({ code, path });
}

function collectLeaf(
	collector: LeafCollector,
	map: YAMLMap,
	key: 'url_poster' | 'url_background',
	slot: ApplySlot,
	path: string
): void {
	const pairs = findPairs(map, key);
	if (pairs.length === 0) return;
	if (pairs.length > 1) {
		addIssue(collector, 'managed_leaf_not_string', path);
		return;
	}
	const value = pairs[0].value;
	if (
		!isScalar(value) ||
		typeof value.value !== 'string' ||
		value.value.length === 0 ||
		utf8Bytes(value.value) > collector.limits.maxScalarBytes
	) {
		addIssue(collector, 'managed_leaf_not_string', path);
		return;
	}
	collector.leaves.push({
		slot,
		slotKey: applySlotKey(slot),
		fingerprint: kometaSlotFingerprint({ state: 'present', url: value.value })
	});
	if (collector.leaves.length > collector.limits.maxManagedLeaves) {
		throw new LegacyMetadataParseError('legacy_leaf_limit_exceeded');
	}
}

function collectEpisodes(
	collector: LeafCollector,
	seasonMap: YAMLMap,
	season: number,
	path: string
): void {
	const episodePairs = findPairs(seasonMap, 'episodes');
	if (episodePairs.length === 0) return;
	if (episodePairs.length > 1 || !isMap(episodePairs[0].value)) {
		addIssue(collector, 'managed_container_not_mapping', `${path}.episodes`);
		return;
	}

	const seen = new Set<number>();
	for (const pair of episodePairs[0].value.items) {
		const episode = normalizeYamlIndex(keyValue(pair.key));
		if (episode === null) {
			addIssue(collector, 'managed_index_not_integer', `${path}.episodes[*]`);
			continue;
		}
		if (seen.has(episode)) {
			addIssue(collector, 'duplicate_managed_index', `${path}.episodes[${episode}]`);
			continue;
		}
		seen.add(episode);
		if (!isMap(pair.value)) {
			addIssue(collector, 'managed_container_not_mapping', `${path}.episodes[${episode}]`);
			continue;
		}
		collectLeaf(
			collector,
			pair.value,
			'url_poster',
			{ kind: 'title_card', season, episode },
			`${path}.episodes[${episode}].url_poster`
		);
	}
}

function collectSeasons(collector: LeafCollector, entry: YAMLMap): void {
	const seasonPairs = findPairs(entry, 'seasons');
	if (seasonPairs.length === 0) return;
	if (seasonPairs.length > 1 || !isMap(seasonPairs[0].value)) {
		addIssue(collector, 'managed_container_not_mapping', 'seasons');
		return;
	}

	const seen = new Set<number>();
	for (const pair of seasonPairs[0].value.items) {
		const season = normalizeYamlIndex(keyValue(pair.key));
		if (season === null) {
			addIssue(collector, 'managed_index_not_integer', 'seasons[*]');
			continue;
		}
		if (seen.has(season)) {
			addIssue(collector, 'duplicate_managed_index', `seasons[${season}]`);
			continue;
		}
		seen.add(season);
		if (!isMap(pair.value)) {
			addIssue(collector, 'managed_container_not_mapping', `seasons[${season}]`);
			continue;
		}
		collectLeaf(
			collector,
			pair.value,
			'url_poster',
			{ kind: 'poster', season, episode: null },
			`seasons[${season}].url_poster`
		);
		collectLeaf(
			collector,
			pair.value,
			'url_background',
			{ kind: 'background', season, episode: null },
			`seasons[${season}].url_background`
		);
		collectEpisodes(collector, pair.value, season, `seasons[${season}]`);
	}
}

function collectEntry(
	pair: Pair,
	sourceIndex: number,
	limits: EffectiveLimits
): ParsedLegacyMetadataEntry {
	const legacyMappingId = normalizeLegacyMappingId(keyValue(pair.key));
	const keyFingerprint = migrationYamlNodeFingerprint(pair.key);
	const displayKey = legacyMappingId ?? `unsupported:${keyFingerprint.slice(0, 12)}`;
	const collector: LeafCollector = { leaves: [], issues: [], limits };
	if (legacyMappingId === null) {
		addIssue(collector, 'unsupported_legacy_key', `metadata[${sourceIndex}]`);
	}
	if (!isMap(pair.value)) {
		addIssue(collector, 'entry_not_mapping', `metadata[${sourceIndex}]`);
	} else {
		collectLeaf(
			collector,
			pair.value,
			'url_poster',
			{ kind: 'poster', season: null, episode: null },
			'url_poster'
		);
		collectLeaf(
			collector,
			pair.value,
			'url_background',
			{ kind: 'background', season: null, episode: null },
			'url_background'
		);
		collectSeasons(collector, pair.value);
	}

	return {
		sourceIndex,
		legacyMappingId,
		displayKey,
		keyFingerprint,
		entryFingerprint: migrationYamlNodeFingerprint(pair.value),
		leaves: collector.leaves,
		shapeIssues: collector.issues
	};
}

/** Parse and structurally validate legacy metadata without retaining URL values. */
export function parseLegacyMetadata(
	raw: string,
	overrides: LegacyMetadataLimitOverrides = {}
): ParsedLegacyMetadata {
	const limits = effectiveLimits(overrides);
	const document = boundedDocument(raw, limits);
	if (document.contents === null) {
		return { sourceFingerprint: hashCanonicalJson({ exists: true, content: raw }), entries: [] };
	}
	if (!isMap(document.contents)) {
		throw new LegacyMetadataParseError('legacy_document_not_mapping');
	}

	const metadataPairs = findPairs(document.contents, 'metadata');
	if (metadataPairs.length === 0) {
		return { sourceFingerprint: hashCanonicalJson({ exists: true, content: raw }), entries: [] };
	}
	if (metadataPairs.length > 1 || !isMap(metadataPairs[0].value)) {
		throw new LegacyMetadataParseError('legacy_metadata_not_mapping');
	}
	const metadata = metadataPairs[0].value;
	if (metadata.items.length > limits.maxEntries) {
		throw new LegacyMetadataParseError('legacy_entry_limit_exceeded');
	}

	const entries = metadata.items.map((pair, sourceIndex) =>
		collectEntry(pair, sourceIndex, limits)
	);
	if (entries.reduce((total, entry) => total + entry.leaves.length, 0) > limits.maxManagedLeaves) {
		throw new LegacyMetadataParseError('legacy_leaf_limit_exceeded');
	}
	const byMappingId = new Map<string, ParsedLegacyMetadataEntry[]>();
	for (const entry of entries) {
		if (entry.legacyMappingId === null) continue;
		const group = byMappingId.get(entry.legacyMappingId) ?? [];
		group.push(entry);
		byMappingId.set(entry.legacyMappingId, group);
	}
	for (const group of byMappingId.values()) {
		if (group.length < 2) continue;
		for (const entry of group) {
			entry.shapeIssues.push({
				code: 'duplicate_legacy_key',
				path: `metadata[${entry.sourceIndex}]`
			});
		}
	}

	return {
		sourceFingerprint: hashCanonicalJson({ exists: true, content: raw }),
		entries
	};
}

function assertNullableBoundedString(
	value: unknown,
	label: string
): asserts value is string | null {
	if (value !== null && (typeof value !== 'string' || utf8Bytes(value) > 256)) {
		throw new TypeError(`Invalid ${label}`);
	}
}

function assertMapping(value: AuthoritativeKometaMapping): void {
	if (
		!Number.isSafeInteger(value.mediaItemId) ||
		value.mediaItemId <= 0 ||
		(value.type !== 'movie' && value.type !== 'show')
	) {
		throw new TypeError('Invalid authoritative Kometa mapping');
	}
	assertNullableBoundedString(value.tmdbId, 'tmdbId');
	assertNullableBoundedString(value.tvdbId, 'tvdbId');
	assertNullableBoundedString(value.imdbId, 'imdbId');
}

function validSlot(slot: ApplySlot): boolean {
	if (slot.kind !== 'poster' && slot.kind !== 'background' && slot.kind !== 'title_card')
		return false;
	if (slot.season !== null && (!Number.isSafeInteger(slot.season) || slot.season < 0)) return false;
	if (slot.episode !== null && (!Number.isSafeInteger(slot.episode) || slot.episode < 0))
		return false;
	if (slot.kind === 'title_card') return slot.season !== null && slot.episode !== null;
	return slot.episode === null;
}

function assertRevision(value: NormalizedLegacyRevisionEvidence): void {
	if (
		typeof value.revisionId !== 'string' ||
		value.revisionId.length === 0 ||
		value.revisionId.trim() !== value.revisionId ||
		utf8Bytes(value.revisionId) > 256 ||
		!Number.isSafeInteger(value.mediaItemId) ||
		value.mediaItemId <= 0 ||
		!isCanonicalKometaNumericId(value.legacyMappingId) ||
		!validSlot(value.slot) ||
		!SHA256.test(value.proposedFingerprint)
	) {
		throw new TypeError('Invalid normalized legacy revision evidence');
	}
}

interface CandidateAssessment {
	destinations: Map<string, KometaDestinationV2>;
	missingIdentifier: boolean;
	hasAuthoritativeRecord: boolean;
	revisionExact: boolean;
	revisionStale: boolean;
}

function assessMappings(
	mappings: AuthoritativeKometaMapping[],
	revisionExact: boolean,
	revisionStale: boolean
): CandidateAssessment {
	const destinations = new Map<string, KometaDestinationV2>();
	let missingIdentifier = false;
	for (const mapping of mappings) {
		const resolved = resolveKometaDestination(mapping);
		if (resolved.ok) destinations.set(resolved.destination.key, resolved.destination);
		else missingIdentifier = true;
	}
	return {
		destinations,
		missingIdentifier,
		hasAuthoritativeRecord: mappings.length > 0,
		revisionExact,
		revisionStale
	};
}

function assessmentSignature(assessment: CandidateAssessment): string {
	return canonicalJson({
		destinations: [...assessment.destinations.keys()].sort(compareCodeUnitStrings),
		missingIdentifier: assessment.missingIdentifier,
		hasAuthoritativeRecord: assessment.hasAuthoritativeRecord
	});
}

function ambiguityForAssessment(assessment: CandidateAssessment): LegacyMigrationAmbiguityReason {
	if (assessment.missingIdentifier) return 'missing_typed_identifier';
	if (assessment.destinations.size > 1) return 'multiple_typed_destinations';
	if (assessment.revisionStale) return 'revision_no_longer_matches';
	return 'no_authoritative_mapping';
}

function normalizedEvidenceFingerprint(
	parsed: ParsedLegacyMetadata,
	mappings: AuthoritativeKometaMapping[],
	revisionMappings: AuthoritativeKometaMapping[],
	revisions: NormalizedLegacyRevisionEvidence[]
): string {
	const normalizeMappings = (values: AuthoritativeKometaMapping[]) =>
		values
			.map((mapping) => ({
				mediaItemId: mapping.mediaItemId,
				type: mapping.type,
				tmdbId: mapping.tmdbId,
				tvdbId: mapping.tvdbId,
				imdbId: mapping.imdbId
			}))
			.sort((left, right) => compareCodeUnitStrings(canonicalJson(left), canonicalJson(right)));
	const normalizedMappings = normalizeMappings(mappings);
	const normalizedRevisionMappings = normalizeMappings(revisionMappings);
	const normalizedRevisions = revisions
		.map((revision) => ({
			revisionId: revision.revisionId,
			mediaItemId: revision.mediaItemId,
			legacyMappingId: revision.legacyMappingId,
			slotKey: applySlotKey(revision.slot),
			proposedFingerprint: revision.proposedFingerprint
		}))
		.sort((left, right) => compareCodeUnitStrings(canonicalJson(left), canonicalJson(right)));
	return hashCanonicalJson({
		sourceFingerprint: parsed.sourceFingerprint,
		mappings: normalizedMappings,
		revisionMappings: normalizedRevisionMappings,
		revisions: normalizedRevisions
	});
}

function ambiguousEntry(
	entry: ParsedLegacyMetadataEntry,
	reason: LegacyMigrationAmbiguityReason
): AmbiguousLegacyMetadataEntry {
	return {
		sourceIndex: entry.sourceIndex,
		legacyMappingId: entry.legacyMappingId,
		displayKey: entry.displayKey,
		entryFingerprint: entry.entryFingerprint,
		slots: entry.leaves.map((leaf) => leaf.slotKey),
		reason
	};
}

/** Classify legacy entries without consulting the key shape or season shape for media kind. */
export function classifyLegacyEntries(
	input: ClassifyLegacyEntriesInput
): LegacyEntryClassificationResult {
	const limits = effectiveLimits(input.limits);
	const revisionMappings = input.revisionMappings ?? [];
	if (input.parsed.entries.length > limits.maxEntries) {
		throw new RangeError('Legacy metadata entry limit exceeded');
	}
	if (
		input.mappings.length > limits.maxMappings ||
		revisionMappings.length > limits.maxMappings ||
		new Set([...input.mappings, ...revisionMappings].map((mapping) => mapping.mediaItemId)).size >
			limits.maxMappings
	) {
		throw new RangeError('Authoritative mapping limit exceeded');
	}
	if (input.revisions.length > limits.maxRevisionEvidence) {
		throw new RangeError('Revision evidence limit exceeded');
	}
	for (const mapping of input.mappings) assertMapping(mapping);
	for (const mapping of revisionMappings) assertMapping(mapping);
	for (const revision of input.revisions) assertRevision(revision);

	const mappingsByItemId = new Map<number, AuthoritativeKometaMapping[]>();
	const mappingsByTmdbId = new Map<string, AuthoritativeKometaMapping[]>();
	for (const mapping of [...input.mappings, ...revisionMappings]) {
		const group = mappingsByItemId.get(mapping.mediaItemId) ?? [];
		group.push(mapping);
		mappingsByItemId.set(mapping.mediaItemId, group);
	}
	for (const mapping of input.mappings) {
		if (mapping.tmdbId !== null) {
			const tmdbGroup = mappingsByTmdbId.get(mapping.tmdbId) ?? [];
			tmdbGroup.push(mapping);
			mappingsByTmdbId.set(mapping.tmdbId, tmdbGroup);
		}
	}
	const revisionsByMappingAndSlot = new Map<string, NormalizedLegacyRevisionEvidence[]>();
	for (const revision of input.revisions) {
		const key = `${revision.legacyMappingId}\0${applySlotKey(revision.slot)}`;
		const group = revisionsByMappingAndSlot.get(key) ?? [];
		group.push(revision);
		revisionsByMappingAndSlot.set(key, group);
	}

	const classified: ClassifiedLegacyMetadataEntry[] = [];
	const ambiguous: AmbiguousLegacyMetadataEntry[] = [];
	for (const entry of input.parsed.entries) {
		if (entry.legacyMappingId === null) {
			ambiguous.push(ambiguousEntry(entry, 'unsupported_legacy_key'));
			continue;
		}
		if (entry.shapeIssues.length > 0) {
			ambiguous.push(ambiguousEntry(entry, 'unsupported_entry_shape'));
			continue;
		}

		const directMappings = mappingsByTmdbId.get(entry.legacyMappingId) ?? [];
		const direct = assessMappings(directMappings, false, false);
		const assessments: CandidateAssessment[] = [];
		for (const leaf of entry.leaves) {
			const revisions =
				revisionsByMappingAndSlot.get(`${entry.legacyMappingId}\0${leaf.slotKey}`) ?? [];
			const exact = revisions.filter(
				(revision) => revision.proposedFingerprint === leaf.fingerprint
			);
			if (exact.length === 0) {
				assessments.push({
					...direct,
					revisionStale: revisions.length > 0
				});
				continue;
			}
			const revisionMappings = exact.flatMap(
				(revision) => mappingsByItemId.get(revision.mediaItemId) ?? []
			);
			assessments.push(assessMappings(revisionMappings, true, false));
		}
		if (assessments.length === 0) assessments.push(direct);

		const everySafe = assessments.every(
			(assessment) => assessment.destinations.size === 1 && !assessment.missingIdentifier
		);
		if (everySafe) {
			const destinations = new Map<string, KometaDestinationV2>();
			for (const assessment of assessments) {
				for (const [key, destination] of assessment.destinations)
					destinations.set(key, destination);
			}
			if (destinations.size === 1) {
				classified.push({
					sourceIndex: entry.sourceIndex,
					legacyMappingId: entry.legacyMappingId,
					displayKey: entry.displayKey,
					entryFingerprint: entry.entryFingerprint,
					slots: entry.leaves.map((leaf) => leaf.slotKey),
					destination: [...destinations.values()][0],
					evidence: assessments.some((assessment) => assessment.revisionExact)
						? 'revision'
						: 'mapping'
				});
				continue;
			}
			ambiguous.push(ambiguousEntry(entry, 'mixed_slot_provenance'));
			continue;
		}

		const signatures = new Set(assessments.map(assessmentSignature));
		const hasSafeSlot = assessments.some(
			(assessment) => assessment.destinations.size === 1 && !assessment.missingIdentifier
		);
		const hasExactRevision = assessments.some((assessment) => assessment.revisionExact);
		if (signatures.size > 1 || (hasExactRevision && hasSafeSlot)) {
			ambiguous.push(ambiguousEntry(entry, 'mixed_slot_provenance'));
			continue;
		}

		const combined: CandidateAssessment = {
			destinations: new Map(),
			missingIdentifier: assessments.some((assessment) => assessment.missingIdentifier),
			hasAuthoritativeRecord: assessments.some((assessment) => assessment.hasAuthoritativeRecord),
			revisionExact: hasExactRevision,
			revisionStale: assessments.some((assessment) => assessment.revisionStale)
		};
		for (const assessment of assessments) {
			for (const [key, destination] of assessment.destinations) {
				combined.destinations.set(key, destination);
			}
		}
		ambiguous.push(ambiguousEntry(entry, ambiguityForAssessment(combined)));
	}

	return {
		sourceFingerprint: input.parsed.sourceFingerprint,
		evidenceFingerprint: normalizedEvidenceFingerprint(
			input.parsed,
			input.mappings,
			revisionMappings,
			input.revisions
		),
		classified,
		ambiguous
	};
}

import { resolve } from 'node:path';
import type { KometaConfigMode } from '$lib/server/config';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { KometaSnapshot } from './config';
import {
	isKometaDestinationV2,
	type KometaDestinationV2,
	type KometaMediaKind
} from './destination';
import { validateConfigPathBinding, type ConfigPathBinding } from './config-io';
import { kometaFileFingerprint } from './plan';

export const KOMETA_MIGRATION_PLAN_KIND = 'kometa_split_migration' as const;
export const KOMETA_MIGRATION_PLAN_VERSION = 1 as const;

const SHA256 = /^[0-9a-f]{64}$/;
const MIGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
// The classifier accepts at most 20k legacy entries. Each classified entry is
// represented once in its summary and at most once more as either a file diff
// or a target-conflict ambiguity, so the complete redacted preview needs 2x.
const MAX_DISPLAY_ENTRIES = 40_000;
const MAX_MANUAL_SNIPPET_BYTES = 512 * 1024;

export type KometaMigrationActivation = 'managed' | 'manual';

export type KometaMigrationAmbiguityReason =
	| 'unsupported_legacy_key'
	| 'unsupported_entry_shape'
	| 'no_authoritative_mapping'
	| 'missing_typed_identifier'
	| 'multiple_typed_destinations'
	| 'mixed_slot_provenance'
	| 'revision_no_longer_matches'
	| 'typed_target_conflict'
	| 'incompatible_entry_shape';

export interface KometaMigrationClassifiedDisplay {
	legacyKey: string;
	entryFingerprint: string;
	slots: string[];
	destination: KometaDestinationV2;
	evidence: 'mapping' | 'revision';
}

export interface KometaMigrationAmbiguousDisplay {
	legacyKey: string;
	entryFingerprint: string;
	slots: string[];
	reason: KometaMigrationAmbiguityReason;
}

export interface KometaMigrationFileDisplay {
	filename: string;
	physicalPath: string;
	configReference: string;
	sourceFingerprint: string;
	proposedFingerprint: string;
	added: number;
	unchanged: number;
	changes: KometaMigrationFileChange[];
}

export interface KometaMigrationFileChange {
	operation: 'add' | 'unchanged' | 'normalize_key';
	path: string;
	targetMappingId: string;
	entryFingerprint: string;
	targetFingerprint: string | null;
}

export interface KometaMigrationLibraryChange {
	library: string;
	mediaKind: KometaMediaKind;
	before: string[];
	after: string;
}

export interface KometaMigrationDisplay {
	classified: KometaMigrationClassifiedDisplay[];
	ambiguous: KometaMigrationAmbiguousDisplay[];
	files: {
		movie: KometaMigrationFileDisplay;
		show: KometaMigrationFileDisplay;
	};
	libraries: KometaMigrationLibraryChange[];
	diffTruncated: boolean;
}

export interface KometaMigrationFrozenFile {
	path: string;
	sourceFingerprint: string;
	proposedFingerprint: string;
	/** Exact bytes authorized by confirmation. Never returned by the public preview. */
	proposedContent: string;
}

export interface KometaMigrationConfigTarget {
	activation: KometaMigrationActivation;
	path: string | null;
	mode: KometaConfigMode | null;
	sourceFingerprint: string | null;
	proposedFingerprint: string | null;
	/** Exact config bytes for managed activation; null for manual wiring. */
	proposedContent: string | null;
}

export interface KometaMigrationPathBindings {
	legacy: ConfigPathBinding;
	movie: ConfigPathBinding;
	show: ConfigPathBinding;
	config: ConfigPathBinding | null;
}

export interface KometaMigrationPlanPayload {
	type: typeof KOMETA_MIGRATION_PLAN_KIND;
	version: typeof KOMETA_MIGRATION_PLAN_VERSION;
	migrationId: string;
	serverInstanceId: string;
	serverName: string;
	outputDirectory: string;
	metadataPathPrefix: string;
	references: { movie: string; show: string };
	/** Canonical filesystem names authorized by the preview. Never exposed publicly. */
	pathBindings: KometaMigrationPathBindings;
	legacy: { path: string; sourceFingerprint: string };
	files: {
		movie: KometaMigrationFrozenFile;
		show: KometaMigrationFrozenFile;
	};
	config: KometaMigrationConfigTarget;
	evidenceFingerprint: string;
	/** Ownership state restored together with config.yml during an explicit rollback. */
	previousSnapshot: KometaSnapshot | null;
	/** Exact deep snapshot-and-presence identity observed when the preview was built. */
	previousSnapshotFingerprint: string;
	/** Frozen ownership baseline installed only after activation succeeds. */
	nextSnapshot: KometaSnapshot;
	/** Safe, exact instructions for an unmanaged config. Does not contain provider URLs. */
	manualSnippet: string | null;
	manualSnippetFingerprint: string | null;
	display: KometaMigrationDisplay;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function kometaMigrationBaselineFingerprint(snapshot: KometaSnapshot | null): string {
	return hashCanonicalJson({ snapshot });
}

function assertString(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
		throw new TypeError(`${label} must be a non-empty trimmed string`);
	}
}

function assertFingerprint(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${label} must be a SHA-256 fingerprint`);
	}
}

function assertPathBinding(value: unknown, expectedPath: string, label: string): void {
	let binding: ConfigPathBinding;
	try {
		binding = validateConfigPathBinding(value);
	} catch {
		throw new TypeError(`${label} must be a valid frozen path binding`);
	}
	if (binding.canonicalPath !== expectedPath) {
		throw new TypeError(`${label} does not match its migration path`);
	}
}

function assertPathBindings(
	value: unknown,
	paths: { legacy: string; movie: string; show: string; config: string | null }
): asserts value is KometaMigrationPathBindings {
	if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'config,legacy,movie,show') {
		throw new TypeError('Invalid Kometa migration path bindings');
	}
	assertPathBinding(value.legacy, paths.legacy, 'pathBindings.legacy');
	assertPathBinding(value.movie, paths.movie, 'pathBindings.movie');
	assertPathBinding(value.show, paths.show, 'pathBindings.show');
	if (paths.config === null) {
		if (value.config !== null) {
			throw new TypeError('Inactive Kometa config cannot carry a frozen path binding');
		}
	} else {
		assertPathBinding(value.config, paths.config, 'pathBindings.config');
	}
}

function assertFrozenFile(
	value: unknown,
	label: string
): asserts value is KometaMigrationFrozenFile {
	if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
	assertString(value.path, `${label}.path`);
	if (resolve(value.path) !== value.path) throw new TypeError(`${label}.path must be absolute`);
	assertFingerprint(value.sourceFingerprint, `${label}.sourceFingerprint`);
	assertFingerprint(value.proposedFingerprint, `${label}.proposedFingerprint`);
	if (typeof value.proposedContent !== 'string') {
		throw new TypeError(`${label}.proposedContent must be a string`);
	}
	if (kometaFileFingerprint(value.proposedContent) !== value.proposedFingerprint) {
		throw new TypeError(`${label} proposed fingerprint mismatch`);
	}
}

function assertConfigTarget(value: unknown): asserts value is KometaMigrationConfigTarget {
	if (!isRecord(value) || (value.activation !== 'managed' && value.activation !== 'manual')) {
		throw new TypeError('Invalid Kometa migration config target');
	}
	if (value.activation === 'manual') {
		if (value.path !== null) {
			assertString(value.path, 'config.path');
			if (resolve(value.path) !== value.path) throw new TypeError('config.path must be absolute');
			if (value.mode !== 'merge' && value.mode !== 'own') {
				throw new TypeError('Observed manual config requires its configured mode');
			}
			if (value.sourceFingerprint !== null) {
				assertFingerprint(value.sourceFingerprint, 'config.sourceFingerprint');
			}
		} else if (value.mode !== null || value.sourceFingerprint !== null) {
			throw new TypeError('Inactive manual config cannot carry config state');
		}
		if (value.proposedFingerprint !== null || value.proposedContent !== null) {
			throw new TypeError('Manual Kometa migration cannot carry proposed config bytes');
		}
		return;
	}

	assertString(value.path, 'config.path');
	if (resolve(value.path) !== value.path) throw new TypeError('config.path must be absolute');
	if (value.mode !== 'merge' && value.mode !== 'own') {
		throw new TypeError('Managed Kometa migration requires a config mode');
	}
	assertFingerprint(value.sourceFingerprint, 'config.sourceFingerprint');
	assertFingerprint(value.proposedFingerprint, 'config.proposedFingerprint');
	if (typeof value.proposedContent !== 'string') {
		throw new TypeError('Managed Kometa migration requires proposed config bytes');
	}
	if (kometaFileFingerprint(value.proposedContent) !== value.proposedFingerprint) {
		throw new TypeError('Managed Kometa config proposed fingerprint mismatch');
	}
}

function assertDisplay(value: unknown): asserts value is KometaMigrationDisplay {
	if (
		!isRecord(value) ||
		!Array.isArray(value.classified) ||
		!Array.isArray(value.ambiguous) ||
		!isRecord(value.files) ||
		!isRecord(value.files.movie) ||
		!isRecord(value.files.show) ||
		!Array.isArray(value.files.movie.changes) ||
		!Array.isArray(value.files.show.changes) ||
		!Array.isArray(value.libraries) ||
		typeof value.diffTruncated !== 'boolean' ||
		value.classified.length +
			value.ambiguous.length +
			value.files.movie.changes.length +
			value.files.show.changes.length >
			MAX_DISPLAY_ENTRIES
	) {
		throw new TypeError('Invalid Kometa migration display payload');
	}
	for (const entry of value.classified) {
		if (!isRecord(entry)) throw new TypeError('Invalid classified Kometa migration entry');
		assertString(entry.legacyKey, 'classified.legacyKey');
		assertFingerprint(entry.entryFingerprint, 'classified.entryFingerprint');
		if (!Array.isArray(entry.slots) || entry.slots.some((slot) => typeof slot !== 'string')) {
			throw new TypeError('Invalid classified Kometa migration slots');
		}
		if (!isKometaDestinationV2(entry.destination)) {
			throw new TypeError('Invalid classified Kometa migration destination');
		}
		if (entry.evidence !== 'mapping' && entry.evidence !== 'revision') {
			throw new TypeError('Invalid classified Kometa migration evidence');
		}
	}
	for (const entry of value.ambiguous) {
		if (!isRecord(entry)) throw new TypeError('Invalid ambiguous Kometa migration entry');
		assertString(entry.legacyKey, 'ambiguous.legacyKey');
		assertFingerprint(entry.entryFingerprint, 'ambiguous.entryFingerprint');
		if (!Array.isArray(entry.slots) || entry.slots.some((slot) => typeof slot !== 'string')) {
			throw new TypeError('Invalid ambiguous Kometa migration slots');
		}
		assertString(entry.reason, 'ambiguous.reason');
	}
	for (const file of [value.files.movie, value.files.show]) {
		if (!Array.isArray(file.changes)) {
			throw new TypeError('Invalid Kometa migration file changes');
		}
		assertString(file.filename, 'file.filename');
		assertString(file.physicalPath, 'file.physicalPath');
		if (resolve(file.physicalPath) !== file.physicalPath) {
			throw new TypeError('Migration display path must be absolute');
		}
		assertString(file.configReference, 'file.configReference');
		assertFingerprint(file.sourceFingerprint, 'file.sourceFingerprint');
		assertFingerprint(file.proposedFingerprint, 'file.proposedFingerprint');
		if (
			typeof file.added !== 'number' ||
			!Number.isSafeInteger(file.added) ||
			file.added < 0 ||
			typeof file.unchanged !== 'number' ||
			!Number.isSafeInteger(file.unchanged) ||
			file.unchanged < 0
		) {
			throw new TypeError('Invalid Kometa migration file counts');
		}
		for (const change of file.changes) {
			if (
				!isRecord(change) ||
				!['add', 'unchanged', 'normalize_key'].includes(String(change.operation))
			) {
				throw new TypeError('Invalid Kometa migration file change');
			}
			assertString(change.path, 'file.change.path');
			assertString(change.targetMappingId, 'file.change.targetMappingId');
			assertFingerprint(change.entryFingerprint, 'file.change.entryFingerprint');
			if (change.targetFingerprint !== null) {
				assertFingerprint(change.targetFingerprint, 'file.change.targetFingerprint');
			}
		}
	}
}

/** Validate decrypted plan bytes before any migration source is read or written. */
export function assertKometaMigrationPlanPayload(
	payload: unknown
): asserts payload is KometaMigrationPlanPayload {
	if (
		!isRecord(payload) ||
		payload.type !== KOMETA_MIGRATION_PLAN_KIND ||
		payload.version !== KOMETA_MIGRATION_PLAN_VERSION ||
		typeof payload.migrationId !== 'string' ||
		!MIGRATION_ID.test(payload.migrationId)
	) {
		throw new TypeError('Invalid Kometa migration plan identity');
	}
	assertString(payload.serverInstanceId, 'serverInstanceId');
	assertString(payload.serverName, 'serverName');
	assertString(payload.outputDirectory, 'outputDirectory');
	if (resolve(payload.outputDirectory) !== payload.outputDirectory) {
		throw new TypeError('Kometa migration output directory must be absolute');
	}
	if (typeof payload.metadataPathPrefix !== 'string') {
		throw new TypeError('Invalid Kometa metadata path prefix');
	}
	if (!isRecord(payload.references)) throw new TypeError('Invalid Kometa migration references');
	assertString(payload.references.movie, 'references.movie');
	assertString(payload.references.show, 'references.show');
	if (!isRecord(payload.legacy)) throw new TypeError('Invalid Kometa legacy source');
	assertString(payload.legacy.path, 'legacy.path');
	if (resolve(payload.legacy.path) !== payload.legacy.path) {
		throw new TypeError('Kometa legacy source path must be absolute');
	}
	assertFingerprint(payload.legacy.sourceFingerprint, 'legacy.sourceFingerprint');
	if (!isRecord(payload.files)) throw new TypeError('Invalid Kometa migration files');
	assertFrozenFile(payload.files.movie, 'files.movie');
	assertFrozenFile(payload.files.show, 'files.show');
	assertConfigTarget(payload.config);
	assertPathBindings(payload.pathBindings, {
		legacy: payload.legacy.path,
		movie: payload.files.movie.path,
		show: payload.files.show.path,
		config: payload.config.path
	});
	assertFingerprint(payload.evidenceFingerprint, 'evidenceFingerprint');
	if (payload.previousSnapshot !== null && !isRecord(payload.previousSnapshot)) {
		throw new TypeError('Invalid previous Kometa snapshot');
	}
	assertFingerprint(payload.previousSnapshotFingerprint, 'previousSnapshotFingerprint');
	if (
		kometaMigrationBaselineFingerprint(payload.previousSnapshot as KometaSnapshot | null) !==
		payload.previousSnapshotFingerprint
	) {
		throw new TypeError('Previous Kometa snapshot fingerprint mismatch');
	}
	if (!isRecord(payload.nextSnapshot)) throw new TypeError('Invalid next Kometa snapshot');
	if (
		payload.manualSnippet !== null &&
		(typeof payload.manualSnippet !== 'string' ||
			Buffer.byteLength(payload.manualSnippet, 'utf8') > MAX_MANUAL_SNIPPET_BYTES)
	) {
		throw new TypeError('Invalid Kometa manual migration snippet');
	}
	if (payload.config.activation === 'manual') {
		if (payload.manualSnippet === null) throw new TypeError('Manual migration requires a snippet');
		assertFingerprint(payload.manualSnippetFingerprint, 'manualSnippetFingerprint');
		if (
			hashCanonicalJson({ content: payload.manualSnippet }) !== payload.manualSnippetFingerprint
		) {
			throw new TypeError('Kometa manual snippet fingerprint mismatch');
		}
	} else if (payload.manualSnippet !== null || payload.manualSnippetFingerprint !== null) {
		throw new TypeError('Managed migration cannot carry a manual snippet');
	}
	assertDisplay(payload.display);

	const paths = [
		payload.legacy.path,
		payload.files.movie.path,
		payload.files.show.path,
		...(payload.config.path ? [payload.config.path] : [])
	].map((path) => resolve(path));
	if (new Set(paths).size !== paths.length) {
		throw new TypeError('Kometa migration targets must be physically distinct');
	}
}

export function kometaManualSnippetFingerprint(content: string): string {
	return hashCanonicalJson({ content });
}

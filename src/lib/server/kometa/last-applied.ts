import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { KometaSnapshot, ManagedLib } from './config';
import { normalizeKometaMetadataPathPrefix } from './reference-path';

const KEY_PREFIX = 'kometaLastApplied:v2:';
const ENVELOPE_KIND = 'kometa_last_applied' as const;
const ENVELOPE_VERSION = 2 as const;

export interface KometaSnapshotScope {
	serverInstanceId: string;
	configPath: string | null;
	outputDirectory: string;
	metadataPathPrefix: string;
}

interface KometaLastAppliedEnvelopeV2 {
	type: typeof ENVELOPE_KIND;
	version: typeof ENVELOPE_VERSION;
	scope: KometaSnapshotScope;
	snapshot: KometaSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isManagedLibrary(value: unknown): value is ManagedLib {
	if (!isRecord(value) || !isStringArray(value.defaults)) return false;
	for (const key of ['metadataReference', 'metadataFile'] as const) {
		if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') {
			return false;
		}
	}
	if (value.metadata !== undefined && typeof value.metadata !== 'boolean') return false;
	for (const key of ['overlays', 'operations', 'settingsKeys'] as const) {
		if (value[key] !== undefined && !isStringArray(value[key])) return false;
	}
	return true;
}

function isKometaSnapshot(value: unknown): value is KometaSnapshot {
	if (!isRecord(value) || !isRecord(value.libraries) || !isStringArray(value.managedSettingKeys)) {
		return false;
	}
	if (value.metadataPath !== undefined && typeof value.metadataPath !== 'string') return false;
	if (
		value.metadataPathPrefix !== undefined &&
		(typeof value.metadataPathPrefix !== 'string' ||
			normalizeKometaMetadataPathPrefix(value.metadataPathPrefix) !== value.metadataPathPrefix)
	) {
		return false;
	}
	if (!Object.values(value.libraries).every(isManagedLibrary)) return false;
	if (value.connections !== undefined) {
		if (!isRecord(value.connections)) return false;
		if (!Object.values(value.connections).every(isStringArray)) return false;
	}
	return true;
}

function assertKometaSnapshotScope(value: unknown): asserts value is KometaSnapshotScope {
	if (
		!isRecord(value) ||
		typeof value.serverInstanceId !== 'string' ||
		value.serverInstanceId.length === 0 ||
		value.serverInstanceId.trim() !== value.serverInstanceId ||
		(value.configPath !== null &&
			(typeof value.configPath !== 'string' || !isAbsolute(value.configPath))) ||
		typeof value.outputDirectory !== 'string' ||
		!isAbsolute(value.outputDirectory) ||
		typeof value.metadataPathPrefix !== 'string' ||
		normalizeKometaMetadataPathPrefix(value.metadataPathPrefix) !== value.metadataPathPrefix
	) {
		throw new TypeError('Invalid Kometa last-applied scope');
	}
}

function scopeIdentity(scope: KometaSnapshotScope): string {
	assertKometaSnapshotScope(scope);
	return JSON.stringify([
		scope.serverInstanceId,
		scope.configPath,
		scope.outputDirectory,
		scope.metadataPathPrefix
	]);
}

/** Opaque settings key: paths remain authenticated inside the value, not exposed in the key. */
export function kometaLastAppliedSettingKey(scope: KometaSnapshotScope): string {
	return `${KEY_PREFIX}${createHash('sha256').update(scopeIdentity(scope)).digest('hex')}`;
}

export function serializeKometaLastApplied(
	scope: KometaSnapshotScope,
	snapshot: KometaSnapshot
): string {
	assertKometaSnapshotScope(scope);
	if (!isKometaSnapshot(snapshot)) throw new TypeError('Invalid Kometa last-applied snapshot');
	const envelope: KometaLastAppliedEnvelopeV2 = {
		type: ENVELOPE_KIND,
		version: ENVELOPE_VERSION,
		scope,
		snapshot
	};
	return JSON.stringify(envelope);
}

/**
 * Decode only an exact v2 scope. Plain legacy snapshots intentionally return null:
 * they remain on disk for compatibility, but cannot prove ownership after a server
 * or path switch and therefore must never authorize removals in merge mode.
 */
export function parseKometaLastApplied(
	raw: string,
	expectedScope: KometaSnapshotScope
): KometaSnapshot | null {
	assertKometaSnapshotScope(expectedScope);
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.type !== ENVELOPE_KIND || value.version !== ENVELOPE_VERSION) {
		return null;
	}
	try {
		assertKometaSnapshotScope(value.scope);
	} catch {
		return null;
	}
	if (!isDeepStrictEqual(value.scope, expectedScope) || !isKometaSnapshot(value.snapshot)) {
		return null;
	}
	return structuredClone(value.snapshot);
}

export function storedKometaLastAppliedMatches(
	raw: string | null,
	scope: KometaSnapshotScope,
	expectedSnapshot: KometaSnapshot | null
): boolean {
	if (raw === null) return expectedSnapshot === null;
	const actual = parseKometaLastApplied(raw, scope);
	return (
		actual !== null && expectedSnapshot !== null && isDeepStrictEqual(actual, expectedSnapshot)
	);
}

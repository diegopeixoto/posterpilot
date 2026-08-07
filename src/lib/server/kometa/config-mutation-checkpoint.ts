import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import type { KometaConfigMode, KometaConfigMutationStateCommit } from '$lib/server/config';
import { decryptSecret, encryptSecret, isEncrypted } from '$lib/server/secrets/crypto';
import { getEncryptionKey } from '$lib/server/secrets/key';
import { kometaLastAppliedSettingKey, serializeKometaLastApplied } from './last-applied';
import {
	assertKometaMigrationControlLease,
	type KometaMigrationControlLease
} from './migration-control-lock';
import { validateConfigPathBinding, type ConfigPathBinding } from './config-io';
import {
	kometaFileFingerprint,
	kometaProposedFingerprint,
	type KometaConfigPlanAction
} from './plan';
import { normalizeKometaMetadataPathPrefix } from './reference-path';

export const KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY = 'kometaConfigMutationCheckpoint:v1';
const KOMETA_CONFIG_MUTATION_CHECKPOINT_KIND = 'kometa_config_mutation_checkpoint' as const;
const KOMETA_CONFIG_MUTATION_CHECKPOINT_VERSION = 1 as const;

const KOMETA_MANAGED_LIBRARIES_KEY = 'kometaManagedLibraries';
const KOMETA_DEFAULT_COLLECTIONS_KEY = 'kometaDefaultCollections';
const KOMETA_MANAGED_SETTINGS_KEY = 'kometaManagedSettings';
const SHA256 = /^[0-9a-f]{64}$/;
// Must stay byte-for-byte compatible with config-io's commit-proof filename grammar.
const CONFIG_COMMIT_PROOF_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

export interface KometaConfigMutationCheckpointV1 {
	type: typeof KOMETA_CONFIG_MUTATION_CHECKPOINT_KIND;
	version: typeof KOMETA_CONFIG_MUTATION_CHECKPOINT_VERSION;
	status: 'prepared' | 'completed';
	checkpointId: string;
	proofToken: string;
	planId: string;
	planDigest: string;
	serverInstanceId: string;
	action: KometaConfigPlanAction;
	configMode: KometaConfigMode;
	metadataPathPrefix: string;
	pathBinding: ConfigPathBinding;
	sourceContent: string | null;
	sourceFingerprint: string;
	proposedContent: string;
	proposedFingerprint: string;
	structuredDependencyFingerprint: string | null;
	stateCommit: KometaConfigMutationStateCommit;
}

export interface CreateKometaConfigMutationCheckpointInput {
	checkpointId?: string;
	proofToken?: string;
	planId: string;
	planDigest: string;
	serverInstanceId: string;
	action: KometaConfigPlanAction;
	configMode: KometaConfigMode;
	metadataPathPrefix: string;
	pathBinding: ConfigPathBinding;
	sourceContent: string | null;
	sourceFingerprint: string;
	proposedContent: string;
	proposedFingerprint: string;
	structuredDependencyFingerprint: string | null;
	stateCommit: KometaConfigMutationStateCommit;
}

type KometaConfigMutationCheckpointErrorCode =
	| 'checkpoint_corrupt'
	| 'checkpoint_exists'
	| 'checkpoint_changed';

class KometaConfigMutationCheckpointError extends Error {
	constructor(
		readonly code: KometaConfigMutationCheckpointErrorCode,
		options: ErrorOptions = {}
	) {
		super(code, options);
		this.name = 'KometaConfigMutationCheckpointError';
	}
}

type CheckpointDatabase = typeof db;

export interface KometaConfigMutationCheckpointStoreOptions {
	encryptionKey?: () => Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isOpaque(value: unknown): value is string {
	return (
		typeof value === 'string' && value.length > 0 && value.length <= 1_024 && !value.includes('\0')
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([key, entry]) => key.length > 0 && !key.includes('\0') && typeof entry === 'string'
		)
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([key, entry]) => key.length > 0 && !key.includes('\0') && isStringArray(entry)
		)
	);
}

function assertStateCommit(
	value: unknown,
	serverInstanceId: string,
	pathBinding: ConfigPathBinding,
	action: KometaConfigPlanAction,
	metadataPathPrefix: string
): asserts value is KometaConfigMutationStateCommit {
	const hasStructuredState = isRecord(value) && Object.hasOwn(value, 'structured');
	if (
		!isRecord(value) ||
		!hasExactKeys(
			value,
			hasStructuredState ? ['managedSettings', 'structured'] : ['managedSettings']
		) ||
		!isStringRecord(value.managedSettings) ||
		(action === 'structured') !== hasStructuredState
	) {
		throw new TypeError('Invalid Kometa configuration mutation state commit');
	}
	if (!hasStructuredState) return;
	const structured = value.structured;
	if (
		!isRecord(structured) ||
		!hasExactKeys(structured, ['managedLibraries', 'defaultCollections', 'lastApplied', 'scope']) ||
		!isStringArray(structured.managedLibraries) ||
		!isStringArrayRecord(structured.defaultCollections) ||
		!isRecord(structured.scope) ||
		!hasExactKeys(structured.scope, [
			'serverInstanceId',
			'configPath',
			'outputDirectory',
			'metadataPathPrefix'
		]) ||
		typeof structured.scope.serverInstanceId !== 'string' ||
		structured.scope.serverInstanceId !== serverInstanceId ||
		typeof structured.scope.configPath !== 'string' ||
		structured.scope.configPath !== pathBinding.canonicalPath ||
		typeof structured.scope.outputDirectory !== 'string' ||
		typeof structured.scope.metadataPathPrefix !== 'string' ||
		structured.scope.metadataPathPrefix !== metadataPathPrefix
	) {
		throw new TypeError('Invalid structured Kometa configuration mutation state commit');
	}

	// The last-applied serializer is the canonical validator for both scope and
	// snapshot. It also rejects relative paths and malformed ownership records.
	const scope: Parameters<typeof serializeKometaLastApplied>[0] = {
		serverInstanceId: structured.scope.serverInstanceId,
		configPath: structured.scope.configPath,
		outputDirectory: structured.scope.outputDirectory,
		metadataPathPrefix: structured.scope.metadataPathPrefix
	};
	serializeKometaLastApplied(
		scope,
		structured.lastApplied as unknown as Parameters<typeof serializeKometaLastApplied>[1]
	);
}

/** Validate the complete authenticated recovery payload before trusting any field. */
export function assertKometaConfigMutationCheckpoint(
	value: unknown
): asserts value is KometaConfigMutationCheckpointV1 {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'type',
			'version',
			'status',
			'checkpointId',
			'proofToken',
			'planId',
			'planDigest',
			'serverInstanceId',
			'action',
			'configMode',
			'metadataPathPrefix',
			'pathBinding',
			'sourceContent',
			'sourceFingerprint',
			'proposedContent',
			'proposedFingerprint',
			'structuredDependencyFingerprint',
			'stateCommit'
		]) ||
		value.type !== KOMETA_CONFIG_MUTATION_CHECKPOINT_KIND ||
		value.version !== KOMETA_CONFIG_MUTATION_CHECKPOINT_VERSION ||
		(value.status !== 'prepared' && value.status !== 'completed') ||
		!isOpaque(value.checkpointId) ||
		typeof value.proofToken !== 'string' ||
		!CONFIG_COMMIT_PROOF_TOKEN.test(value.proofToken) ||
		!isOpaque(value.planId) ||
		typeof value.planDigest !== 'string' ||
		!SHA256.test(value.planDigest) ||
		!isOpaque(value.serverInstanceId) ||
		value.serverInstanceId.trim() !== value.serverInstanceId ||
		(value.action !== 'structured' && value.action !== 'raw' && value.action !== 'restore') ||
		(value.configMode !== 'merge' && value.configMode !== 'own') ||
		typeof value.metadataPathPrefix !== 'string' ||
		(value.sourceContent !== null && typeof value.sourceContent !== 'string') ||
		typeof value.sourceFingerprint !== 'string' ||
		!SHA256.test(value.sourceFingerprint) ||
		typeof value.proposedContent !== 'string' ||
		typeof value.proposedFingerprint !== 'string' ||
		!SHA256.test(value.proposedFingerprint) ||
		(value.action === 'structured'
			? typeof value.structuredDependencyFingerprint !== 'string' ||
				!SHA256.test(value.structuredDependencyFingerprint)
			: value.structuredDependencyFingerprint !== null)
	) {
		throw new TypeError('Invalid Kometa configuration mutation checkpoint');
	}
	let metadataPathPrefix: string;
	try {
		metadataPathPrefix = normalizeKometaMetadataPathPrefix(value.metadataPathPrefix);
	} catch {
		throw new TypeError('Invalid Kometa configuration mutation checkpoint metadata scope');
	}
	if (metadataPathPrefix !== value.metadataPathPrefix) {
		throw new TypeError('Invalid Kometa configuration mutation checkpoint metadata scope');
	}

	const pathBinding = validateConfigPathBinding(value.pathBinding);
	if (
		kometaFileFingerprint(value.sourceContent) !== value.sourceFingerprint ||
		kometaProposedFingerprint(value.proposedContent) !== value.proposedFingerprint
	) {
		throw new TypeError('Kometa configuration mutation checkpoint fingerprint mismatch');
	}
	assertStateCommit(
		value.stateCommit,
		value.serverInstanceId,
		pathBinding,
		value.action,
		metadataPathPrefix
	);
	let roundTripped: unknown;
	try {
		roundTripped = JSON.parse(JSON.stringify(value));
	} catch {
		throw new TypeError('Kometa configuration mutation checkpoint is not JSON-stable');
	}
	if (!isDeepStrictEqual(roundTripped, value)) {
		throw new TypeError('Kometa configuration mutation checkpoint is not JSON-stable');
	}
}

/** Create a normalized V1 checkpoint with fresh opaque proof identities by default. */
export function createKometaConfigMutationCheckpoint(
	input: CreateKometaConfigMutationCheckpointInput
): KometaConfigMutationCheckpointV1 {
	const stateCommit: KometaConfigMutationStateCommit = input.stateCommit.structured
		? {
				managedSettings: structuredClone(input.stateCommit.managedSettings),
				structured: structuredClone(input.stateCommit.structured)
			}
		: { managedSettings: structuredClone(input.stateCommit.managedSettings) };
	const candidate: KometaConfigMutationCheckpointV1 = {
		type: KOMETA_CONFIG_MUTATION_CHECKPOINT_KIND,
		version: KOMETA_CONFIG_MUTATION_CHECKPOINT_VERSION,
		status: 'prepared',
		checkpointId: input.checkpointId ?? randomUUID(),
		proofToken: input.proofToken ?? randomUUID(),
		planId: input.planId,
		planDigest: input.planDigest,
		serverInstanceId: input.serverInstanceId,
		action: input.action,
		configMode: input.configMode,
		metadataPathPrefix: input.metadataPathPrefix,
		pathBinding: structuredClone(input.pathBinding),
		sourceContent: input.sourceContent,
		sourceFingerprint: input.sourceFingerprint,
		proposedContent: input.proposedContent,
		proposedFingerprint: input.proposedFingerprint,
		structuredDependencyFingerprint: input.structuredDependencyFingerprint,
		stateCommit
	};
	const checkpoint: unknown = JSON.parse(JSON.stringify(candidate));
	assertKometaConfigMutationCheckpoint(checkpoint);
	return checkpoint;
}

function sameCheckpoint(
	actual: KometaConfigMutationCheckpointV1,
	expected: KometaConfigMutationCheckpointV1
): boolean {
	return isDeepStrictEqual(actual, expected);
}

/** Build a checkpoint store; dependency injection keeps focused tests `$env`-free. */
export function createKometaConfigMutationCheckpointStore(
	database: CheckpointDatabase,
	options: KometaConfigMutationCheckpointStoreOptions = {}
) {
	const encryptionKey = options.encryptionKey ?? getEncryptionKey;

	function serialize(checkpoint: KometaConfigMutationCheckpointV1): string {
		assertKometaConfigMutationCheckpoint(checkpoint);
		return encryptSecret(JSON.stringify(checkpoint), encryptionKey());
	}

	function parse(stored: string): KometaConfigMutationCheckpointV1 {
		let value: unknown;
		try {
			if (!isEncrypted(stored)) throw new Error('checkpoint is not encrypted');
			value = JSON.parse(decryptSecret(stored, encryptionKey()));
			assertKometaConfigMutationCheckpoint(value);
		} catch (cause) {
			throw new KometaConfigMutationCheckpointError('checkpoint_corrupt', { cause });
		}
		return value;
	}

	async function load(): Promise<KometaConfigMutationCheckpointV1 | null> {
		const [row] = await database
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY))
			.limit(1);
		return row ? parse(row.value) : null;
	}

	async function prepare(
		checkpoint: KometaConfigMutationCheckpointV1,
		controlLease: KometaMigrationControlLease
	): Promise<KometaConfigMutationCheckpointV1> {
		assertKometaConfigMutationCheckpoint(checkpoint);
		if (checkpoint.status !== 'prepared') {
			throw new TypeError(
				'Only a prepared Kometa configuration mutation checkpoint can be installed'
			);
		}
		const encrypted = serialize(checkpoint);
		return database.transaction(async (tx) => {
			await assertKometaMigrationControlLease(tx, controlLease);
			const [current] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY))
				.limit(1);
			if (current) {
				const existing = parse(current.value);
				if (sameCheckpoint(existing, checkpoint)) return existing;
				throw new KometaConfigMutationCheckpointError('checkpoint_exists');
			}
			const [inserted] = await tx
				.insert(settings)
				.values({ key: KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY, value: encrypted })
				.onConflictDoNothing()
				.returning({ key: settings.key });
			if (inserted) return structuredClone(checkpoint);

			// A separately connected process may have won an insert race before this
			// transaction obtained SQLite's write lock. Classify the exact winner.
			const [winner] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY))
				.limit(1);
			if (winner) {
				const existing = parse(winner.value);
				if (sameCheckpoint(existing, checkpoint)) return existing;
			}
			throw new KometaConfigMutationCheckpointError('checkpoint_exists');
		});
	}

	async function writeSetting(
		transaction: Parameters<Parameters<CheckpointDatabase['transaction']>[0]>[0],
		key: string,
		value: string
	): Promise<void> {
		await transaction
			.insert(settings)
			.values({ key, value })
			.onConflictDoUpdate({ target: settings.key, set: { value } });
	}

	async function persistStateCommit(
		transaction: Parameters<Parameters<CheckpointDatabase['transaction']>[0]>[0],
		stateCommit: KometaConfigMutationStateCommit
	): Promise<void> {
		if (stateCommit.structured) {
			await writeSetting(
				transaction,
				KOMETA_MANAGED_LIBRARIES_KEY,
				JSON.stringify(stateCommit.structured.managedLibraries.map(String))
			);
			await writeSetting(
				transaction,
				KOMETA_DEFAULT_COLLECTIONS_KEY,
				JSON.stringify(stateCommit.structured.defaultCollections)
			);
			await writeSetting(
				transaction,
				kometaLastAppliedSettingKey(stateCommit.structured.scope),
				serializeKometaLastApplied(stateCommit.structured.scope, stateCommit.structured.lastApplied)
			);
		}
		await writeSetting(
			transaction,
			KOMETA_MANAGED_SETTINGS_KEY,
			JSON.stringify(stateCommit.managedSettings)
		);
	}

	async function completeBundle(
		expected: KometaConfigMutationCheckpointV1,
		controlLease: KometaMigrationControlLease
	): Promise<KometaConfigMutationCheckpointV1> {
		assertKometaConfigMutationCheckpoint(expected);
		if (expected.status !== 'prepared') {
			throw new TypeError('Only a prepared Kometa configuration mutation checkpoint can complete');
		}
		const completed: KometaConfigMutationCheckpointV1 = {
			...structuredClone(expected),
			status: 'completed'
		};
		const completedValue = serialize(completed);
		return database.transaction(async (tx) => {
			await assertKometaMigrationControlLease(tx, controlLease);
			const [current] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY))
				.limit(1);
			if (!current) {
				throw new KometaConfigMutationCheckpointError('checkpoint_changed');
			}
			const stored = parse(current.value);
			if (sameCheckpoint(stored, completed)) return stored;
			if (!sameCheckpoint(stored, expected)) {
				throw new KometaConfigMutationCheckpointError('checkpoint_changed');
			}

			await persistStateCommit(tx, expected.stateCommit);
			const [updated] = await tx
				.update(settings)
				.set({ value: completedValue })
				.where(
					and(
						eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY),
						eq(settings.value, current.value)
					)
				)
				.returning({ key: settings.key });
			if (!updated) throw new KometaConfigMutationCheckpointError('checkpoint_changed');
			return completed;
		});
	}

	async function discard(
		expected: KometaConfigMutationCheckpointV1,
		controlLease: KometaMigrationControlLease
	): Promise<void> {
		assertKometaConfigMutationCheckpoint(expected);
		if (expected.status !== 'prepared') {
			throw new TypeError(
				'Only a prepared Kometa configuration mutation checkpoint can be discarded'
			);
		}
		await database.transaction(async (tx) => {
			await assertKometaMigrationControlLease(tx, controlLease);
			const [current] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY))
				.limit(1);
			if (!current || !sameCheckpoint(parse(current.value), expected)) {
				throw new KometaConfigMutationCheckpointError('checkpoint_changed');
			}
			const [deleted] = await tx
				.delete(settings)
				.where(
					and(
						eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY),
						eq(settings.value, current.value)
					)
				)
				.returning({ key: settings.key });
			if (!deleted) throw new KometaConfigMutationCheckpointError('checkpoint_changed');
		});
	}

	async function finalizeCleanup(
		expected: KometaConfigMutationCheckpointV1,
		controlLease: KometaMigrationControlLease
	): Promise<void> {
		assertKometaConfigMutationCheckpoint(expected);
		if (expected.status !== 'completed') {
			throw new TypeError(
				'Only a completed Kometa configuration mutation checkpoint can be finalized'
			);
		}
		await database.transaction(async (tx) => {
			await assertKometaMigrationControlLease(tx, controlLease);
			const [current] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY))
				.limit(1);
			// Final cleanup is intentionally retry-safe after a response is lost.
			if (!current) return;
			if (!sameCheckpoint(parse(current.value), expected)) {
				throw new KometaConfigMutationCheckpointError('checkpoint_changed');
			}
			const [deleted] = await tx
				.delete(settings)
				.where(
					and(
						eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY),
						eq(settings.value, current.value)
					)
				)
				.returning({ key: settings.key });
			if (!deleted) throw new KometaConfigMutationCheckpointError('checkpoint_changed');
		});
	}

	return { load, prepare, completeBundle, discard, finalizeCleanup };
}

const kometaConfigMutationCheckpointStore = createKometaConfigMutationCheckpointStore(db);

export function loadKometaConfigMutationCheckpoint(): Promise<KometaConfigMutationCheckpointV1 | null> {
	return kometaConfigMutationCheckpointStore.load();
}

export function prepareKometaConfigMutationCheckpoint(
	checkpoint: KometaConfigMutationCheckpointV1,
	controlLease: KometaMigrationControlLease
): Promise<KometaConfigMutationCheckpointV1> {
	return kometaConfigMutationCheckpointStore.prepare(checkpoint, controlLease);
}

export function completeKometaConfigMutationCheckpointBundle(
	expected: KometaConfigMutationCheckpointV1,
	controlLease: KometaMigrationControlLease
): Promise<KometaConfigMutationCheckpointV1> {
	return kometaConfigMutationCheckpointStore.completeBundle(expected, controlLease);
}

export function discardKometaConfigMutationCheckpoint(
	expected: KometaConfigMutationCheckpointV1,
	controlLease: KometaMigrationControlLease
): Promise<void> {
	return kometaConfigMutationCheckpointStore.discard(expected, controlLease);
}

export function finalizeKometaConfigMutationCheckpointCleanup(
	expected: KometaConfigMutationCheckpointV1,
	controlLease: KometaMigrationControlLease
): Promise<void> {
	return kometaConfigMutationCheckpointStore.finalizeCleanup(expected, controlLease);
}

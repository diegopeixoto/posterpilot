import { and, eq, like } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { decryptSecret, encryptSecret } from '$lib/server/secrets/crypto';
import { getEncryptionKey } from '$lib/server/secrets/key';
import type { KometaSnapshot } from './config';
import { canonicalConfigPath } from './config-io';
import { kometaFileFingerprint } from './plan';
import {
	kometaLastAppliedSettingKey,
	serializeKometaLastApplied,
	storedKometaLastAppliedMatches,
	type KometaSnapshotScope
} from './last-applied';
import {
	assertKometaMigrationJournal,
	isEffectlessKometaMigrationFailure,
	type KometaMigrationJournalV1
} from './migration-journal';
import type { KometaMigrationEvidenceDatabase } from './migration-evidence';
import {
	assertKometaMigrationControlLease,
	type KometaMigrationControlLease
} from './migration-control-lock';

const JOURNAL_KEY_PREFIX = 'kometaMigrationJournal:';
const MISSING_FILE_FINGERPRINT = kometaFileFingerprint(null);

export type KometaMigrationStoreErrorCode =
	| 'journal_changed'
	| 'baseline_changed'
	| 'journal_unreadable'
	| 'multiple_active_journals';

export class KometaMigrationStoreError extends Error {
	constructor(readonly code: KometaMigrationStoreErrorCode) {
		super(code);
		this.name = 'KometaMigrationStoreError';
	}
}

export type KometaMigrationCompletionEvidenceState = 'current' | 'changed' | 'unavailable';

class KometaMigrationCompletionEvidenceAbort extends Error {
	constructor(readonly state: Exclude<KometaMigrationCompletionEvidenceState, 'current'>) {
		super(state);
		this.name = 'KometaMigrationCompletionEvidenceAbort';
	}
}

function journalKey(serverInstanceId: string): string {
	if (!serverInstanceId || serverInstanceId.trim() !== serverInstanceId) {
		throw new TypeError('Kometa migration server scope is required');
	}
	return `${JOURNAL_KEY_PREFIX}${serverInstanceId}`;
}

function serializeJournal(journal: KometaMigrationJournalV1): string {
	assertKometaMigrationJournal(journal);
	return encryptSecret(JSON.stringify(journal), getEncryptionKey());
}

function parseJournal(stored: string): KometaMigrationJournalV1 {
	let value: unknown;
	try {
		value = JSON.parse(decryptSecret(stored, getEncryptionKey()));
	} catch {
		throw new Error('Kometa migration journal could not be authenticated');
	}
	assertKometaMigrationJournal(value);
	return value;
}

interface StoredJournalRow {
	key: string;
	value: string;
}

function parseStoredJournalRow(row: StoredJournalRow): KometaMigrationJournalV1 {
	try {
		if (!row.key.startsWith(JOURNAL_KEY_PREFIX)) {
			throw new Error('Invalid Kometa migration journal key');
		}
		const serverInstanceId = row.key.slice(JOURNAL_KEY_PREFIX.length);
		const journal = parseJournal(row.value);
		if (!serverInstanceId || journal.payload.serverInstanceId !== serverInstanceId) {
			throw new Error('Kometa migration journal scope does not match its key');
		}
		return journal;
	} catch (error) {
		if (error instanceof KometaMigrationStoreError) throw error;
		throw new KometaMigrationStoreError('journal_unreadable');
	}
}

function selectActiveJournal(rows: readonly StoredJournalRow[]): KometaMigrationJournalV1 | null {
	const active: KometaMigrationJournalV1[] = [];
	for (const row of rows) {
		const journal = parseStoredJournalRow(row);
		if (journal.status !== 'completed' && journal.status !== 'rolled_back') active.push(journal);
	}
	if (active.length > 1) {
		throw new KometaMigrationStoreError('multiple_active_journals');
	}
	return active[0] ?? null;
}

async function listStoredJournalRows(
	database: Pick<typeof db, 'select'>
): Promise<StoredJournalRow[]> {
	return database
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(like(settings.key, `${JOURNAL_KEY_PREFIX}%`));
}

function snapshotScope(journal: KometaMigrationJournalV1): KometaSnapshotScope {
	return {
		serverInstanceId: journal.payload.serverInstanceId,
		configPath:
			journal.payload.config.path === null
				? null
				: canonicalConfigPath(journal.payload.config.path),
		outputDirectory: canonicalConfigPath(journal.payload.outputDirectory),
		metadataPathPrefix: journal.payload.metadataPathPrefix
	};
}

function sameJournal(
	actual: KometaMigrationJournalV1 | null,
	expected: KometaMigrationJournalV1 | null
): boolean {
	return isDeepStrictEqual(actual, expected);
}

function assertPristinePreparedJournal(journal: KometaMigrationJournalV1): void {
	if (
		journal.status !== 'prepared' ||
		Object.values(journal.checkpoints).some(Boolean) ||
		Object.values(journal.backups).some((backup) => backup !== null) ||
		journal.activationEvidence !== null ||
		journal.lastFailure !== null ||
		journal.completedAt !== null ||
		journal.rolledBackAt !== null
	) {
		throw new TypeError('Only a pristine prepared Kometa migration journal can be installed');
	}
}

function assertSameFrozenMigration(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1
): void {
	const projected = structuredClone(expectedJournal);
	projected.status = journal.status;
	projected.checkpoints = journal.checkpoints;
	projected.backups = journal.backups;
	projected.activationEvidence = journal.activationEvidence;
	projected.lastFailure = journal.lastFailure;
	projected.updatedAt = journal.updatedAt;
	projected.completedAt = journal.completedAt;
	projected.rolledBackAt = journal.rolledBackAt;
	if (!sameJournal(projected, journal)) {
		throw new TypeError('Kometa migration journal cannot change its frozen plan');
	}
}

function assertIntermediateTransition(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1
): void {
	assertKometaMigrationJournal(expectedJournal);
	assertSameFrozenMigration(journal, expectedJournal);
	const validRollbackPreparation =
		(expectedJournal.status === 'completed' &&
			journal.status === 'rollback_prepared' &&
			journal.lastFailure === null) ||
		((expectedJournal.status === 'failed' || expectedJournal.status === 'recovery_required') &&
			journal.status === 'rollback_prepared' &&
			journal.lastFailure === null &&
			!journal.checkpoints.baselinePersisted) ||
		(expectedJournal.status === 'rollback_prepared' && journal.status === 'rollback_prepared');
	const validAbandonment =
		(expectedJournal.status === 'failed' || expectedJournal.status === 'recovery_required') &&
		journal.status === 'abandoned' &&
		journal.lastFailure !== null &&
		isDeepStrictEqual(journal.lastFailure, expectedJournal.lastFailure);
	if (
		((journal.status === 'rollback_prepared' || expectedJournal.status === 'rollback_prepared') &&
			!validRollbackPreparation) ||
		((journal.status === 'abandoned' || expectedJournal.status === 'abandoned') &&
			!validAbandonment) ||
		(journal.status === 'completed' && expectedJournal.status !== 'completed') ||
		journal.status === 'rolled_back' ||
		expectedJournal.status === 'rolled_back' ||
		Object.keys(journal.checkpoints).some(
			(key) =>
				expectedJournal.checkpoints[key as keyof typeof journal.checkpoints] &&
				!journal.checkpoints[key as keyof typeof journal.checkpoints]
		) ||
		Object.keys(journal.backups).some((key) => {
			const name = key as keyof typeof journal.backups;
			return (
				expectedJournal.backups[name] !== null &&
				!isDeepStrictEqual(journal.backups[name], expectedJournal.backups[name])
			);
		}) ||
		(expectedJournal.activationEvidence !== null &&
			!isDeepStrictEqual(journal.activationEvidence, expectedJournal.activationEvidence)) ||
		(expectedJournal.completedAt !== null && journal.completedAt !== expectedJournal.completedAt) ||
		(expectedJournal.rolledBackAt !== null && journal.rolledBackAt !== expectedJournal.rolledBackAt)
	) {
		throw new TypeError('Invalid intermediate Kometa migration journal transition');
	}
}

function assertCompletableJournal(journal: KometaMigrationJournalV1): void {
	if (
		journal.status !== 'completed' ||
		!journal.checkpoints.baselinePersisted ||
		journal.lastFailure !== null ||
		journal.rolledBackAt !== null ||
		(journal.payload.config.activation === 'manual' && journal.checkpoints.configVerified)
	) {
		throw new TypeError('Only a correctly activated Kometa migration journal can be finalized');
	}
}

function assertCompletionTransition(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1
): void {
	assertKometaMigrationJournal(expectedJournal);
	const expectedStatus =
		journal.payload.config.activation === 'managed' ? 'config_written' : 'awaiting_manual_wiring';
	if (
		expectedJournal.status !== expectedStatus ||
		expectedJournal.checkpoints.baselinePersisted ||
		expectedJournal.lastFailure !== null ||
		expectedJournal.completedAt !== null ||
		expectedJournal.rolledBackAt !== null
	) {
		throw new TypeError('Invalid Kometa migration completion predecessor');
	}
	const transitioned = structuredClone(expectedJournal);
	transitioned.status = 'completed';
	transitioned.checkpoints = { ...transitioned.checkpoints, baselinePersisted: true };
	if (journal.payload.config.activation === 'manual') {
		transitioned.activationEvidence = journal.activationEvidence;
	}
	transitioned.lastFailure = null;
	transitioned.updatedAt = journal.updatedAt;
	transitioned.completedAt = journal.completedAt;
	if (!sameJournal(transitioned, journal)) {
		throw new TypeError('Kometa migration completion does not match its predecessor');
	}
}

function assertRollbackTransition(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1
): void {
	assertKometaMigrationJournal(expectedJournal);
	if (expectedJournal.status !== 'rollback_prepared') {
		throw new TypeError('Invalid Kometa migration rollback predecessor');
	}
	const transitioned = structuredClone(expectedJournal);
	transitioned.status = 'rolled_back';
	transitioned.lastFailure = null;
	transitioned.updatedAt = journal.updatedAt;
	transitioned.rolledBackAt = journal.rolledBackAt;
	if (!sameJournal(transitioned, journal)) {
		throw new TypeError('Kometa migration rollback does not match its predecessor');
	}
}

export async function loadKometaMigrationJournal(
	serverInstanceId: string
): Promise<KometaMigrationJournalV1 | null> {
	const [row] = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, journalKey(serverInstanceId)))
		.limit(1);
	return row
		? parseStoredJournalRow({ key: journalKey(serverInstanceId), value: row.value })
		: null;
}

/**
 * Return the one globally active migration journal. Every prefixed row is
 * authenticated before terminal rows are ignored so corrupt history cannot
 * accidentally make an in-flight migration disappear from guards.
 */
export async function loadActiveKometaMigrationJournal(): Promise<KometaMigrationJournalV1 | null> {
	try {
		return selectActiveJournal(await listStoredJournalRows(db));
	} catch (error) {
		if (error instanceof KometaMigrationStoreError) throw error;
		throw new KometaMigrationStoreError('journal_unreadable');
	}
}

/** Preserve a current terminal baseline only when no journal owns another scope. */
export async function loadKometaMigrationJournalForGuard(
	serverInstanceId: string | null | undefined
): Promise<KometaMigrationJournalV1 | null> {
	const active = await loadActiveKometaMigrationJournal();
	if (active || !serverInstanceId) return active;
	return loadKometaMigrationJournal(serverInstanceId);
}

export async function saveKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1,
	controlLease?: KometaMigrationControlLease
): Promise<void> {
	assertKometaMigrationJournal(journal);
	assertIntermediateTransition(journal, expectedJournal);
	const key = journalKey(journal.payload.serverInstanceId);
	const value = serializeJournal(journal);
	await db.transaction(async (tx) => {
		if (controlLease) await assertKometaMigrationControlLease(tx, controlLease);
		const active = selectActiveJournal(await listStoredJournalRows(tx));
		if (active && !sameJournal(active, expectedJournal) && !sameJournal(active, journal)) {
			throw new KometaMigrationStoreError('journal_changed');
		}
		const [current] = await tx
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, key))
			.limit(1);
		if (!current) throw new KometaMigrationStoreError('journal_changed');
		const currentJournal = parseJournal(current.value);
		if (sameJournal(currentJournal, journal)) return;
		if (!sameJournal(currentJournal, expectedJournal)) {
			throw new KometaMigrationStoreError('journal_changed');
		}
		const [updated] = await tx
			.update(settings)
			.set({ value })
			.where(and(eq(settings.key, key), eq(settings.value, current.value)))
			.returning({ key: settings.key });
		if (!updated) throw new KometaMigrationStoreError('journal_changed');
	});
}

/**
 * Install the recoverable prepared boundary before consuming the one-use preview.
 * The exact prior terminal journal is compare-and-set so two app processes cannot
 * replace one another's in-flight migration.
 */
export async function prepareKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1 | null,
	controlLease?: KometaMigrationControlLease
): Promise<void> {
	assertKometaMigrationJournal(journal);
	assertPristinePreparedJournal(journal);
	if (expectedJournal !== null) {
		assertKometaMigrationJournal(expectedJournal);
		if (
			expectedJournal.status !== 'completed' &&
			expectedJournal.status !== 'rolled_back' &&
			expectedJournal.status !== 'abandoned' &&
			!isEffectlessKometaMigrationFailure(expectedJournal)
		) {
			throw new TypeError(
				'A prepared journal can replace only an exact terminal or effectless failed journal'
			);
		}
	}
	const key = journalKey(journal.payload.serverInstanceId);
	const value = serializeJournal(journal);
	await db.transaction(async (tx) => {
		if (controlLease) await assertKometaMigrationControlLease(tx, controlLease);
		const active = selectActiveJournal(await listStoredJournalRows(tx));
		if (active && !sameJournal(active, expectedJournal)) {
			throw new KometaMigrationStoreError('journal_changed');
		}
		const [current] = await tx
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, key))
			.limit(1);
		const currentJournal = current ? parseJournal(current.value) : null;
		if (!sameJournal(currentJournal, expectedJournal)) {
			throw new KometaMigrationStoreError('journal_changed');
		}
		if (current) {
			const [updated] = await tx
				.update(settings)
				.set({ value })
				.where(and(eq(settings.key, key), eq(settings.value, current.value)))
				.returning({ key: settings.key });
			if (!updated) throw new KometaMigrationStoreError('journal_changed');
		} else {
			const [inserted] = await tx
				.insert(settings)
				.values({ key, value })
				.onConflictDoNothing()
				.returning({ key: settings.key });
			if (!inserted) throw new KometaMigrationStoreError('journal_changed');
		}
	});
}

/** Persist activation ownership and its completed journal in one SQLite transaction. */
export async function completeKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	snapshot: KometaSnapshot,
	expectedJournal: KometaMigrationJournalV1,
	assertEvidenceCurrent?: (
		database: KometaMigrationEvidenceDatabase
	) => Promise<KometaMigrationCompletionEvidenceState>,
	controlLease?: KometaMigrationControlLease
): Promise<KometaMigrationCompletionEvidenceState> {
	assertKometaMigrationJournal(journal);
	assertCompletableJournal(journal);
	assertCompletionTransition(journal, expectedJournal);
	const key = journalKey(journal.payload.serverInstanceId);
	const value = serializeJournal(journal);
	const scope = snapshotScope(journal);
	const baselineKey = kometaLastAppliedSettingKey(scope);
	const baselineValue = serializeKometaLastApplied(scope, snapshot);
	if (!isDeepStrictEqual(snapshot, journal.payload.nextSnapshot)) {
		throw new TypeError('Completed Kometa migration snapshot does not match its frozen plan');
	}
	try {
		await db.transaction(async (tx) => {
			const [currentJournal] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, key))
				.limit(1);
			if (!currentJournal) throw new KometaMigrationStoreError('journal_changed');
			const parsedJournal = parseJournal(currentJournal.value);
			const [currentBaseline] = await tx
				.select({ value: settings.value })
				.from(settings)
				.where(eq(settings.key, baselineKey))
				.limit(1);
			if (sameJournal(parsedJournal, journal)) {
				if (
					!storedKometaLastAppliedMatches(
						currentBaseline?.value ?? null,
						scope,
						journal.payload.nextSnapshot
					)
				) {
					throw new KometaMigrationStoreError('baseline_changed');
				}
				return;
			}
			if (controlLease) await assertKometaMigrationControlLease(tx, controlLease);
			if (assertEvidenceCurrent) {
				const evidenceState = await assertEvidenceCurrent(tx);
				if (evidenceState !== 'current') {
					throw new KometaMigrationCompletionEvidenceAbort(evidenceState);
				}
			}
			if (!sameJournal(parsedJournal, expectedJournal)) {
				throw new KometaMigrationStoreError('journal_changed');
			}
			if (
				!storedKometaLastAppliedMatches(
					currentBaseline?.value ?? null,
					scope,
					journal.payload.previousSnapshot
				)
			) {
				throw new KometaMigrationStoreError('baseline_changed');
			}
			if (currentBaseline) {
				const [updatedBaseline] = await tx
					.update(settings)
					.set({ value: baselineValue })
					.where(and(eq(settings.key, baselineKey), eq(settings.value, currentBaseline.value)))
					.returning({ key: settings.key });
				if (!updatedBaseline) throw new KometaMigrationStoreError('baseline_changed');
			} else {
				const [insertedBaseline] = await tx
					.insert(settings)
					.values({ key: baselineKey, value: baselineValue })
					.onConflictDoNothing()
					.returning({ key: settings.key });
				if (!insertedBaseline) throw new KometaMigrationStoreError('baseline_changed');
			}
			const [updated] = await tx
				.update(settings)
				.set({ value })
				.where(and(eq(settings.key, key), eq(settings.value, currentJournal.value)))
				.returning({ key: settings.key });
			if (!updated) throw new KometaMigrationStoreError('journal_changed');
		});
	} catch (error) {
		if (error instanceof KometaMigrationCompletionEvidenceAbort) return error.state;
		throw error;
	}
	return 'current';
}

/** Finalize a prepared rollback and restore its pre-migration ownership snapshot atomically. */
export async function rollbackKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	snapshot: KometaSnapshot | null,
	expectedJournal: KometaMigrationJournalV1,
	controlLease?: KometaMigrationControlLease
): Promise<void> {
	assertKometaMigrationJournal(journal);
	if (
		journal.status !== 'rolled_back' ||
		journal.payload.config.activation !== 'managed' ||
		(journal.backups.config === null &&
			journal.payload.config.sourceFingerprint !== MISSING_FILE_FINGERPRINT) ||
		journal.lastFailure !== null ||
		!isDeepStrictEqual(snapshot, journal.payload.previousSnapshot)
	) {
		throw new TypeError('Only an exact managed Kometa rollback can be persisted');
	}
	assertRollbackTransition(journal, expectedJournal);
	const key = journalKey(journal.payload.serverInstanceId);
	const value = serializeJournal(journal);
	const scope = snapshotScope(journal);
	const baselineKey = kometaLastAppliedSettingKey(scope);
	await db.transaction(async (tx) => {
		if (controlLease) await assertKometaMigrationControlLease(tx, controlLease);
		const [currentJournal] = await tx
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, key))
			.limit(1);
		if (!currentJournal) throw new KometaMigrationStoreError('journal_changed');
		const parsedJournal = parseJournal(currentJournal.value);
		const [currentBaseline] = await tx
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, baselineKey))
			.limit(1);
		if (sameJournal(parsedJournal, journal)) {
			if (!storedKometaLastAppliedMatches(currentBaseline?.value ?? null, scope, snapshot)) {
				throw new KometaMigrationStoreError('baseline_changed');
			}
			return;
		}
		if (!sameJournal(parsedJournal, expectedJournal)) {
			throw new KometaMigrationStoreError('journal_changed');
		}
		const completedActivation = expectedJournal.checkpoints.baselinePersisted;
		const expectedBaseline = completedActivation
			? journal.payload.nextSnapshot
			: journal.payload.previousSnapshot;
		if (!storedKometaLastAppliedMatches(currentBaseline?.value ?? null, scope, expectedBaseline)) {
			throw new KometaMigrationStoreError('baseline_changed');
		}
		if (!completedActivation) {
			// Recovery rollback restores the config before activation ownership ever
			// committed, so the already-previous baseline remains untouched.
		} else if (snapshot === null) {
			const [deleted] = await tx
				.delete(settings)
				.where(and(eq(settings.key, baselineKey), eq(settings.value, currentBaseline!.value)))
				.returning({ key: settings.key });
			if (!deleted) throw new KometaMigrationStoreError('baseline_changed');
		} else {
			const baselineValue = serializeKometaLastApplied(scope, snapshot);
			const [updatedBaseline] = await tx
				.update(settings)
				.set({ value: baselineValue })
				.where(and(eq(settings.key, baselineKey), eq(settings.value, currentBaseline!.value)))
				.returning({ key: settings.key });
			if (!updatedBaseline) throw new KometaMigrationStoreError('baseline_changed');
		}
		const [updated] = await tx
			.update(settings)
			.set({ value })
			.where(and(eq(settings.key, key), eq(settings.value, currentJournal.value)))
			.returning({ key: settings.key });
		if (!updated) throw new KometaMigrationStoreError('journal_changed');
	});
}

export function kometaMigrationJournalSettingKey(serverInstanceId: string): string {
	return journalKey(serverInstanceId);
}

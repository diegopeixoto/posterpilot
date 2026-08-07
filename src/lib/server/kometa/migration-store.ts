import { and, eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { decryptSecret, encryptSecret } from '$lib/server/secrets/crypto';
import { getEncryptionKey } from '$lib/server/secrets/key';
import type { KometaSnapshot } from './config';
import { canonicalConfigPath } from './config-io';
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

const JOURNAL_KEY_PREFIX = 'kometaMigrationJournal:';

export type KometaMigrationStoreErrorCode = 'journal_changed' | 'baseline_changed';

export class KometaMigrationStoreError extends Error {
	constructor(readonly code: KometaMigrationStoreErrorCode) {
		super(code);
		this.name = 'KometaMigrationStoreError';
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
		(expectedJournal.status === 'rollback_prepared' && journal.status === 'rollback_prepared');
	if (
		((journal.status === 'rollback_prepared' || expectedJournal.status === 'rollback_prepared') &&
			!validRollbackPreparation) ||
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
	return row ? parseJournal(row.value) : null;
}

export async function saveKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	expectedJournal: KometaMigrationJournalV1
): Promise<void> {
	assertKometaMigrationJournal(journal);
	assertIntermediateTransition(journal, expectedJournal);
	const key = journalKey(journal.payload.serverInstanceId);
	const value = serializeJournal(journal);
	await db.transaction(async (tx) => {
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
	expectedJournal: KometaMigrationJournalV1 | null
): Promise<void> {
	assertKometaMigrationJournal(journal);
	assertPristinePreparedJournal(journal);
	if (expectedJournal !== null) {
		assertKometaMigrationJournal(expectedJournal);
		if (
			expectedJournal.status !== 'completed' &&
			expectedJournal.status !== 'rolled_back' &&
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
	expectedJournal: KometaMigrationJournalV1
): Promise<void> {
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
}

/** Finalize a prepared rollback and restore its pre-migration ownership snapshot atomically. */
export async function rollbackKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	snapshot: KometaSnapshot | null,
	expectedJournal: KometaMigrationJournalV1
): Promise<void> {
	assertKometaMigrationJournal(journal);
	if (
		journal.status !== 'rolled_back' ||
		journal.payload.config.activation !== 'managed' ||
		journal.backups.config === null ||
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
		if (
			!storedKometaLastAppliedMatches(
				currentBaseline?.value ?? null,
				scope,
				journal.payload.nextSnapshot
			)
		) {
			throw new KometaMigrationStoreError('baseline_changed');
		}
		if (snapshot === null) {
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

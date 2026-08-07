import { kometaFileFingerprint } from './plan';
import {
	updateKometaMigrationJournal,
	type KometaMigrationFailurePhase,
	type KometaMigrationJournalV1
} from './migration-journal';
import type { KometaSnapshot } from './config';

export type KometaMigrationExecutionErrorCode =
	| 'migration_not_resumable'
	| 'migration_target_changed'
	| 'migration_legacy_changed'
	| 'migration_backup_invalid'
	| 'migration_write_failed'
	| 'migration_verify_failed'
	| 'migration_manual_ack_unavailable'
	| 'migration_rollback_unavailable';

/** Locale-neutral failure. Exact filesystem/provider details never cross the route boundary. */
export class KometaMigrationExecutionError extends Error {
	constructor(
		readonly code: KometaMigrationExecutionErrorCode,
		readonly phase: KometaMigrationFailurePhase,
		readonly recoveryRequired = false
	) {
		super(code);
		this.name = 'KometaMigrationExecutionError';
	}
}

export interface KometaProtectedBackup {
	name: string;
	checksum: string;
}

export interface KometaMigrationExecutorDependencies {
	read(path: string): string | null;
	write(path: string, content: string, stamp: string, expectedSource: string | null): void;
	createProtectedBackup(
		path: string,
		migrationId: string,
		expectedContent: string
	): KometaProtectedBackup;
	readProtectedBackup(path: string, name: string, checksum: string): string;
	/** Final synchronous guard against symlink/hardlink aliasing between preview and write. */
	assertDistinctPaths?(paths: readonly string[]): void;
	saveJournal(
		journal: KometaMigrationJournalV1,
		expectedJournal: KometaMigrationJournalV1
	): Promise<void>;
	completeJournal(
		journal: KometaMigrationJournalV1,
		snapshot: KometaSnapshot,
		expectedJournal: KometaMigrationJournalV1
	): Promise<void>;
	rollbackJournal(
		journal: KometaMigrationJournalV1,
		snapshot: KometaSnapshot | null,
		expectedJournal: KometaMigrationJournalV1
	): Promise<void>;
	now(): Date;
}

function trackedDependencies(
	deps: KometaMigrationExecutorDependencies,
	onPersist: (journal: KometaMigrationJournalV1) => void
): KometaMigrationExecutorDependencies {
	return {
		...deps,
		saveJournal: async (journal, expectedJournal) => {
			await deps.saveJournal(journal, expectedJournal);
			onPersist(journal);
		},
		completeJournal: async (journal, snapshot, expectedJournal) => {
			await deps.completeJournal(journal, snapshot, expectedJournal);
			onPersist(journal);
		},
		rollbackJournal: async (journal, snapshot, expectedJournal) => {
			await deps.rollbackJournal(journal, snapshot, expectedJournal);
			onPersist(journal);
		}
	};
}

type FileName = 'movie' | 'show';
type BackupName = FileName | 'config';

const MISSING_FILE_FINGERPRINT = kometaFileFingerprint(null);

function fingerprint(deps: KometaMigrationExecutorDependencies, path: string): string {
	return kometaFileFingerprint(deps.read(path));
}

function sameCurrent(
	deps: KometaMigrationExecutorDependencies,
	path: string,
	expected: string
): boolean {
	return fingerprint(deps, path) === expected;
}

function backupInvalid(phase: KometaMigrationFailurePhase): never {
	throw new KometaMigrationExecutionError('migration_backup_invalid', phase, true);
}

/**
 * Re-read a durable backup identity and bind its exact bytes back to the
 * previewed source fingerprint. The stored checksum protects the backup file;
 * the source fingerprint protects the journal-to-plan relationship.
 */
function assertProtectedBackup(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	name: BackupName,
	path: string,
	sourceFingerprint: string,
	proposedFingerprint: string,
	phase: KometaMigrationFailurePhase
): string | null {
	const backup = journal.backups[name];
	const required =
		sourceFingerprint !== MISSING_FILE_FINGERPRINT && sourceFingerprint !== proposedFingerprint;
	if (backup === null) {
		if (required) backupInvalid(phase);
		return null;
	}

	let content: string;
	try {
		content = deps.readProtectedBackup(path, backup.name, backup.fingerprint);
	} catch {
		backupInvalid(phase);
	}
	if (kometaFileFingerprint(content) !== sourceFingerprint) backupInvalid(phase);
	return content;
}

function assertCurrent(
	deps: KometaMigrationExecutorDependencies,
	path: string,
	expectedFingerprint: string,
	phase: KometaMigrationFailurePhase
): void {
	if (!sameCurrent(deps, path, expectedFingerprint)) targetChanged(phase);
}

function migrationPaths(journal: KometaMigrationJournalV1): string[] {
	return [
		journal.payload.legacy.path,
		journal.payload.files.movie.path,
		journal.payload.files.show.path,
		...(journal.payload.config.path ? [journal.payload.config.path] : [])
	];
}

function assertPhysicalTargets(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	phase: KometaMigrationFailurePhase
): void {
	try {
		deps.assertDistinctPaths?.(migrationPaths(journal));
	} catch {
		throw new KometaMigrationExecutionError('migration_target_changed', phase, true);
	}
}

async function persistFailure(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	error: unknown,
	phase: KometaMigrationFailurePhase
): Promise<KometaMigrationJournalV1> {
	const known = error instanceof KometaMigrationExecutionError ? error : null;
	// Atomic writes are safely retryable from either the frozen source or proposed
	// fingerprint. Only an observed divergent/failed-verification state requires
	// manual recovery; ordinary I/O failures remain resumable even after progress.
	const recoveryRequired = known?.recoveryRequired ?? false;
	const next = updateKometaMigrationJournal(
		journal,
		{
			status: recoveryRequired ? 'recovery_required' : 'failed',
			lastFailure: {
				phase: known?.phase ?? phase,
				code: known?.code ?? 'migration_write_failed',
				at: deps.now().toISOString()
			}
		},
		deps.now()
	);
	try {
		await deps.saveJournal(next, journal);
	} catch {
		// The original bounded failure remains the useful signal. The caller can
		// recover from the last durable checkpoint on the next manager load.
	}
	return next;
}

function targetChanged(phase: KometaMigrationFailurePhase): never {
	throw new KometaMigrationExecutionError('migration_target_changed', phase, true);
}

function legacyChanged(): never {
	throw new KometaMigrationExecutionError('migration_legacy_changed', 'source_revalidate', true);
}

async function saveStatus(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	patch: Parameters<typeof updateKometaMigrationJournal>[1]
): Promise<KometaMigrationJournalV1> {
	const next = updateKometaMigrationJournal(journal, patch, deps.now());
	await deps.saveJournal(next, journal);
	return next;
}

async function ensureProtectedBackup(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	name: BackupName,
	path: string,
	current: string | null
): Promise<KometaMigrationJournalV1> {
	if (current === null || journal.backups[name] !== null) return journal;
	const backup = deps.createProtectedBackup(path, journal.migrationId, current);
	return saveStatus(deps, journal, {
		backups: {
			...journal.backups,
			[name]: { name: backup.name, fingerprint: backup.checksum }
		}
	});
}

async function writeSplit(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	name: FileName
): Promise<KometaMigrationJournalV1> {
	// The legacy document is the semantic source for both proposed split bytes.
	// Re-read it after every preceding journal await before creating any backup.
	assertLegacyUnchanged(deps, journal);
	const file = journal.payload.files[name];
	const checkpoint = name === 'movie' ? 'movieVerified' : 'showVerified';
	const backupPhase = name === 'movie' ? 'movie_backup' : 'show_backup';
	const writePhase = name === 'movie' ? 'movie_write' : 'show_write';
	const verifyPhase = name === 'movie' ? 'movie_verify' : 'show_verify';
	const current = deps.read(file.path);
	const currentFingerprint = kometaFileFingerprint(current);
	let sourceContent: string | null;
	let expectedCurrentFingerprint: string;

	if (currentFingerprint !== file.proposedFingerprint) {
		if (currentFingerprint !== file.sourceFingerprint) targetChanged(backupPhase);
		journal = await ensureProtectedBackup(deps, journal, name, file.path, current);
		sourceContent = assertProtectedBackup(
			deps,
			journal,
			name,
			file.path,
			file.sourceFingerprint,
			file.proposedFingerprint,
			backupPhase
		);
		expectedCurrentFingerprint = file.sourceFingerprint;
	} else {
		sourceContent = assertProtectedBackup(
			deps,
			journal,
			name,
			file.path,
			file.sourceFingerprint,
			file.proposedFingerprint,
			verifyPhase
		);
		expectedCurrentFingerprint = file.proposedFingerprint;
	}
	// saveJournal/createProtectedBackup are observable async boundaries. The
	// bound writer receives the exact predecessor too, closing the final gap
	// between this check and its first filesystem read. Calling it for an
	// already-published target also finalizes a crash-left quarantine.
	assertLegacyUnchanged(deps, journal);
	assertCurrent(deps, file.path, expectedCurrentFingerprint, writePhase);
	assertPhysicalTargets(deps, journal, writePhase);
	try {
		deps.write(file.path, file.proposedContent, `${journal.migrationId}-${name}`, sourceContent);
	} catch {
		throw new KometaMigrationExecutionError('migration_write_failed', writePhase);
	}
	assertProtectedBackup(
		deps,
		journal,
		name,
		file.path,
		file.sourceFingerprint,
		file.proposedFingerprint,
		verifyPhase
	);
	if (!sameCurrent(deps, file.path, file.proposedFingerprint)) {
		throw new KometaMigrationExecutionError('migration_verify_failed', verifyPhase, true);
	}
	return saveStatus(deps, journal, {
		checkpoints: { ...journal.checkpoints, [checkpoint]: true },
		lastFailure: null
	});
}

function assertLegacyUnchanged(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1
): void {
	if (!sameCurrent(deps, journal.payload.legacy.path, journal.payload.legacy.sourceFingerprint)) {
		legacyChanged();
	}
}

function assertSplitBackups(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	phase: KometaMigrationFailurePhase = 'final_verify'
): void {
	for (const [name, file] of Object.entries(journal.payload.files) as [
		FileName,
		(typeof journal.payload.files)[FileName]
	][]) {
		assertProtectedBackup(
			deps,
			journal,
			name,
			file.path,
			file.sourceFingerprint,
			file.proposedFingerprint,
			phase
		);
	}
}

function assertSplitContents(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1,
	phase: KometaMigrationFailurePhase = 'final_verify'
): void {
	for (const file of Object.values(journal.payload.files)) {
		if (!sameCurrent(deps, file.path, file.proposedFingerprint)) {
			throw new KometaMigrationExecutionError('migration_verify_failed', phase, true);
		}
	}
}

function assertActivationInputs(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1
): void {
	// Backup reads may execute filesystem work. Validate them first, then make
	// legacy and both split fingerprints the final reads before config publish.
	assertSplitBackups(deps, journal, 'source_revalidate');
	assertLegacyUnchanged(deps, journal);
	assertSplitContents(deps, journal, 'source_revalidate');
	assertPhysicalTargets(deps, journal, 'source_revalidate');
}

async function finishManaged(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1
): Promise<KometaMigrationJournalV1> {
	const config = journal.payload.config;
	if (
		config.activation !== 'managed' ||
		config.path === null ||
		config.sourceFingerprint === null ||
		config.proposedFingerprint === null ||
		config.proposedContent === null
	) {
		throw new KometaMigrationExecutionError('migration_not_resumable', 'config_write');
	}

	assertActivationInputs(deps, journal);
	const current = deps.read(config.path);
	const currentFingerprint = kometaFileFingerprint(current);
	let sourceContent: string | null;
	let expectedCurrentFingerprint: string;
	if (currentFingerprint !== config.proposedFingerprint) {
		if (currentFingerprint !== config.sourceFingerprint) targetChanged('config_backup');
		journal = await ensureProtectedBackup(deps, journal, 'config', config.path, current);
		sourceContent = assertProtectedBackup(
			deps,
			journal,
			'config',
			config.path,
			config.sourceFingerprint,
			config.proposedFingerprint,
			'config_backup'
		);
		expectedCurrentFingerprint = config.sourceFingerprint;
	} else {
		sourceContent = assertProtectedBackup(
			deps,
			journal,
			'config',
			config.path,
			config.sourceFingerprint,
			config.proposedFingerprint,
			'config_verify'
		);
		expectedCurrentFingerprint = config.proposedFingerprint;
	}
	// The config backup journal write is an async boundary. Revalidate every
	// activation input, then let the writer perform the final exact-source CAS.
	assertActivationInputs(deps, journal);
	assertCurrent(deps, config.path, expectedCurrentFingerprint, 'config_write');
	assertPhysicalTargets(deps, journal, 'config_write');
	try {
		deps.write(config.path, config.proposedContent, `${journal.migrationId}-config`, sourceContent);
	} catch {
		throw new KometaMigrationExecutionError('migration_write_failed', 'config_write');
	}
	assertProtectedBackup(
		deps,
		journal,
		'config',
		config.path,
		config.sourceFingerprint,
		config.proposedFingerprint,
		'config_verify'
	);
	if (!sameCurrent(deps, config.path, config.proposedFingerprint)) {
		throw new KometaMigrationExecutionError('migration_verify_failed', 'config_verify', true);
	}
	journal = await saveStatus(deps, journal, {
		status: 'config_written',
		checkpoints: { ...journal.checkpoints, configVerified: true },
		activationEvidence: { type: 'verified_config', at: deps.now().toISOString() },
		lastFailure: null
	});

	assertProtectedBackup(
		deps,
		journal,
		'config',
		config.path,
		config.sourceFingerprint,
		config.proposedFingerprint,
		'final_verify'
	);
	assertActivationInputs(deps, journal);
	if (!sameCurrent(deps, config.path, config.proposedFingerprint)) {
		throw new KometaMigrationExecutionError('migration_verify_failed', 'final_verify', true);
	}
	const completedAt = deps.now().toISOString();
	const completed = updateKometaMigrationJournal(
		journal,
		{
			status: 'completed',
			checkpoints: { ...journal.checkpoints, baselinePersisted: true },
			completedAt,
			lastFailure: null
		},
		deps.now()
	);
	try {
		await deps.completeJournal(completed, completed.payload.nextSnapshot, journal);
	} catch {
		throw new KometaMigrationExecutionError('migration_write_failed', 'baseline');
	}
	return completed;
}

/** Resume exact frozen bytes from any durable pre-completion checkpoint. */
export async function executeKometaMigration(
	deps: KometaMigrationExecutorDependencies,
	initial: KometaMigrationJournalV1
): Promise<KometaMigrationJournalV1> {
	if (initial.status === 'completed' || initial.status === 'awaiting_manual_wiring') return initial;
	if (
		initial.status === 'rolled_back' ||
		initial.status === 'recovery_required' ||
		initial.status === 'rollback_prepared'
	) {
		throw new KometaMigrationExecutionError('migration_not_resumable', 'prepare');
	}

	let latest = initial;
	const tracked = trackedDependencies(deps, (journal) => {
		latest = journal;
	});
	let journal = initial;
	let phase: KometaMigrationFailurePhase = 'prepare';
	try {
		assertLegacyUnchanged(tracked, journal);
		journal = await saveStatus(tracked, journal, {
			status: 'writing_splits',
			lastFailure: null
		});
		phase = 'movie_backup';
		journal = await writeSplit(tracked, journal, 'movie');
		phase = 'show_backup';
		journal = await writeSplit(tracked, journal, 'show');
		journal = await saveStatus(tracked, journal, { status: 'splits_verified' });

		phase = 'source_revalidate';
		assertActivationInputs(tracked, journal);
		if (journal.payload.config.activation === 'manual') {
			journal = await saveStatus(tracked, journal, {
				status: 'awaiting_manual_wiring',
				lastFailure: null
			});
			assertActivationInputs(tracked, journal);
			return journal;
		}
		phase = 'config_backup';
		return await finishManaged(tracked, journal);
	} catch (error) {
		await persistFailure(tracked, latest, error, phase);
		if (error instanceof KometaMigrationExecutionError) throw error;
		throw new KometaMigrationExecutionError('migration_write_failed', phase);
	}
}

/** Complete only the manual activation baseline after an explicit user acknowledgment. */
export async function acknowledgeManualKometaMigration(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1
): Promise<KometaMigrationJournalV1> {
	if (
		journal.status !== 'awaiting_manual_wiring' ||
		journal.payload.config.activation !== 'manual'
	) {
		throw new KometaMigrationExecutionError(
			'migration_manual_ack_unavailable',
			'manual_acknowledgment'
		);
	}
	let latest = journal;
	const tracked = trackedDependencies(deps, (value) => {
		latest = value;
	});
	try {
		assertActivationInputs(tracked, journal);
		const at = tracked.now().toISOString();
		const completed = updateKometaMigrationJournal(
			journal,
			{
				status: 'completed',
				checkpoints: { ...journal.checkpoints, baselinePersisted: true },
				activationEvidence: { type: 'user_acknowledged', at },
				completedAt: at,
				lastFailure: null
			},
			tracked.now()
		);
		try {
			await tracked.completeJournal(completed, completed.payload.nextSnapshot, journal);
		} catch {
			throw new KometaMigrationExecutionError('migration_write_failed', 'manual_acknowledgment');
		}
		return completed;
	} catch (error) {
		await persistFailure(tracked, latest, error, 'manual_acknowledgment');
		if (error instanceof KometaMigrationExecutionError) throw error;
		throw new KometaMigrationExecutionError('migration_write_failed', 'manual_acknowledgment');
	}
}

/** Restore only the protected config backup. Split files and the legacy file remain untouched. */
export async function rollbackKometaMigration(
	deps: KometaMigrationExecutorDependencies,
	journal: KometaMigrationJournalV1
): Promise<KometaMigrationJournalV1> {
	const config = journal.payload.config;
	const backup = journal.backups.config;
	if (
		(journal.status !== 'completed' && journal.status !== 'rollback_prepared') ||
		config.activation !== 'managed' ||
		config.path === null ||
		config.sourceFingerprint === null ||
		config.proposedFingerprint === null ||
		config.proposedContent === null ||
		backup === null
	) {
		throw new KometaMigrationExecutionError('migration_rollback_unavailable', 'rollback');
	}
	let latest = journal;
	const tracked = trackedDependencies(deps, (value) => {
		latest = value;
	});
	try {
		assertPhysicalTargets(tracked, journal, 'rollback');
		const restored = assertProtectedBackup(
			tracked,
			journal,
			'config',
			config.path,
			config.sourceFingerprint,
			config.proposedFingerprint,
			'rollback'
		);
		if (restored === null) backupInvalid('rollback');

		let prepared = journal;
		const initialFingerprint = fingerprint(tracked, config.path);
		if (journal.status === 'completed') {
			if (initialFingerprint !== config.proposedFingerprint) targetChanged('rollback');
			prepared = await saveStatus(tracked, journal, {
				status: 'rollback_prepared',
				lastFailure: null
			});
		}

		// The durable checkpoint is the predecessor for every filesystem write.
		// Re-read both its protected source and the current config after that await.
		assertProtectedBackup(
			tracked,
			prepared,
			'config',
			config.path,
			config.sourceFingerprint,
			config.proposedFingerprint,
			'rollback'
		);
		const currentFingerprint = fingerprint(tracked, config.path);
		if (
			currentFingerprint !== config.proposedFingerprint &&
			currentFingerprint !== config.sourceFingerprint
		) {
			targetChanged('rollback');
		}
		assertCurrent(tracked, config.path, currentFingerprint, 'rollback');
		assertPhysicalTargets(tracked, prepared, 'rollback');
		try {
			tracked.write(
				config.path,
				restored,
				`${journal.migrationId}-rollback`,
				config.proposedContent
			);
		} catch {
			throw new KometaMigrationExecutionError('migration_write_failed', 'rollback');
		}

		assertProtectedBackup(
			tracked,
			prepared,
			'config',
			config.path,
			config.sourceFingerprint,
			config.proposedFingerprint,
			'rollback'
		);
		assertPhysicalTargets(tracked, prepared, 'rollback');
		if (!sameCurrent(tracked, config.path, config.sourceFingerprint)) {
			throw new KometaMigrationExecutionError('migration_verify_failed', 'rollback', true);
		}
		const rolledBack = updateKometaMigrationJournal(
			prepared,
			{
				status: 'rolled_back',
				rolledBackAt: deps.now().toISOString(),
				lastFailure: null
			},
			tracked.now()
		);
		await tracked.rollbackJournal(rolledBack, rolledBack.payload.previousSnapshot, prepared);
		return rolledBack;
	} catch (error) {
		const failed = updateKometaMigrationJournal(
			latest,
			{
				lastFailure: {
					phase: 'rollback',
					code:
						error instanceof KometaMigrationExecutionError ? error.code : 'migration_write_failed',
					at: tracked.now().toISOString()
				}
			},
			tracked.now()
		);
		try {
			await tracked.saveJournal(failed, latest);
		} catch {
			// Preserve the original safe rollback failure.
		}
		if (error instanceof KometaMigrationExecutionError) throw error;
		throw new KometaMigrationExecutionError('migration_write_failed', 'rollback');
	}
}

import type { KometaMigrationPlanPayload } from './migration-plan';
import { assertKometaMigrationPlanPayload } from './migration-plan';
import { kometaFileFingerprint } from './plan';

const KOMETA_MIGRATION_JOURNAL_KIND = 'kometa_split_migration_journal' as const;
const KOMETA_MIGRATION_JOURNAL_VERSION = 1 as const;

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MISSING_FILE_FINGERPRINT = kometaFileFingerprint(null);

export type KometaMigrationStatus =
	| 'prepared'
	| 'writing_splits'
	| 'splits_verified'
	| 'config_written'
	| 'awaiting_manual_wiring'
	| 'completed'
	| 'failed'
	| 'recovery_required'
	| 'abandoned'
	| 'rollback_prepared'
	| 'rolled_back';

export type KometaMigrationFailurePhase =
	| 'prepare'
	| 'movie_backup'
	| 'movie_write'
	| 'movie_verify'
	| 'show_backup'
	| 'show_write'
	| 'show_verify'
	| 'source_revalidate'
	| 'config_backup'
	| 'config_write'
	| 'config_verify'
	| 'final_verify'
	| 'baseline'
	| 'manual_acknowledgment'
	| 'rollback';

export interface KometaMigrationBackupIdentity {
	name: string;
	fingerprint: string;
}

export interface KometaMigrationJournalV1 {
	type: typeof KOMETA_MIGRATION_JOURNAL_KIND;
	version: typeof KOMETA_MIGRATION_JOURNAL_VERSION;
	migrationId: string;
	planId: string;
	planDigest: string;
	status: KometaMigrationStatus;
	payload: KometaMigrationPlanPayload;
	checkpoints: {
		movieVerified: boolean;
		showVerified: boolean;
		configVerified: boolean;
		baselinePersisted: boolean;
	};
	backups: {
		movie: KometaMigrationBackupIdentity | null;
		show: KometaMigrationBackupIdentity | null;
		config: KometaMigrationBackupIdentity | null;
	};
	activationEvidence:
		| { type: 'verified_config'; at: string }
		| { type: 'user_acknowledged'; at: string }
		| null;
	lastFailure: { phase: KometaMigrationFailurePhase; code: string; at: string } | null;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
	rolledBackAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertTrimmed(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new TypeError(`${label} must be a non-empty trimmed string`);
	}
}

function assertFingerprint(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${label} must be a SHA-256 fingerprint`);
	}
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(value))) {
		throw new TypeError(`${label} must be an ISO timestamp`);
	}
}

function assertBackup(
	value: unknown,
	label: string
): asserts value is KometaMigrationBackupIdentity | null {
	if (value === null) return;
	if (!isRecord(value)) throw new TypeError(`${label} must be a backup identity or null`);
	assertTrimmed(value.name, `${label}.name`);
	if (value.name.includes('/') || value.name.includes('\\') || value.name.includes('..')) {
		throw new TypeError(`${label}.name is unsafe`);
	}
	assertFingerprint(value.fingerprint, `${label}.fingerprint`);
}

const STATUSES = new Set<KometaMigrationStatus>([
	'prepared',
	'writing_splits',
	'splits_verified',
	'config_written',
	'awaiting_manual_wiring',
	'completed',
	'failed',
	'recovery_required',
	'abandoned',
	'rollback_prepared',
	'rolled_back'
]);

const FAILURE_PHASES = new Set<KometaMigrationFailurePhase>([
	'prepare',
	'movie_backup',
	'movie_write',
	'movie_verify',
	'show_backup',
	'show_write',
	'show_verify',
	'source_revalidate',
	'config_backup',
	'config_write',
	'config_verify',
	'final_verify',
	'baseline',
	'manual_acknowledgment',
	'rollback'
]);

/** Reject tampered or structurally impossible durable recovery state. */
export function assertKometaMigrationJournal(
	value: unknown
): asserts value is KometaMigrationJournalV1 {
	if (
		!isRecord(value) ||
		value.type !== KOMETA_MIGRATION_JOURNAL_KIND ||
		value.version !== KOMETA_MIGRATION_JOURNAL_VERSION ||
		typeof value.status !== 'string' ||
		!STATUSES.has(value.status as KometaMigrationStatus)
	) {
		throw new TypeError('Invalid Kometa migration journal');
	}
	assertTrimmed(value.migrationId, 'journal.migrationId');
	assertTrimmed(value.planId, 'journal.planId');
	assertFingerprint(value.planDigest, 'journal.planDigest');
	assertKometaMigrationPlanPayload(value.payload);
	if (value.migrationId !== value.payload.migrationId) {
		throw new TypeError('Kometa migration journal identity mismatch');
	}
	if (!isRecord(value.checkpoints)) throw new TypeError('Invalid migration checkpoints');
	for (const key of [
		'movieVerified',
		'showVerified',
		'configVerified',
		'baselinePersisted'
	] as const) {
		if (typeof value.checkpoints[key] !== 'boolean') {
			throw new TypeError(`Invalid migration checkpoint ${key}`);
		}
	}
	if (!isRecord(value.backups)) throw new TypeError('Invalid migration backups');
	assertBackup(value.backups.movie, 'backups.movie');
	assertBackup(value.backups.show, 'backups.show');
	assertBackup(value.backups.config, 'backups.config');
	if (value.activationEvidence !== null) {
		if (
			!isRecord(value.activationEvidence) ||
			(value.activationEvidence.type !== 'verified_config' &&
				value.activationEvidence.type !== 'user_acknowledged')
		) {
			throw new TypeError('Invalid migration activation evidence');
		}
		assertIsoDate(value.activationEvidence.at, 'activationEvidence.at');
	}
	if (value.lastFailure !== null) {
		if (
			!isRecord(value.lastFailure) ||
			typeof value.lastFailure.phase !== 'string' ||
			!FAILURE_PHASES.has(value.lastFailure.phase as KometaMigrationFailurePhase)
		) {
			throw new TypeError('Invalid migration failure');
		}
		assertTrimmed(value.lastFailure.code, 'lastFailure.code');
		if (value.lastFailure.code.length > 128)
			throw new TypeError('Migration failure code is too long');
		assertIsoDate(value.lastFailure.at, 'lastFailure.at');
	}
	assertIsoDate(value.createdAt, 'journal.createdAt');
	assertIsoDate(value.updatedAt, 'journal.updatedAt');
	if (value.completedAt !== null) assertIsoDate(value.completedAt, 'journal.completedAt');
	if (value.rolledBackAt !== null) assertIsoDate(value.rolledBackAt, 'journal.rolledBackAt');

	if (value.checkpoints.showVerified && !value.checkpoints.movieVerified) {
		throw new TypeError('Show checkpoint cannot precede movie verification');
	}
	if (value.checkpoints.configVerified && !value.checkpoints.showVerified) {
		throw new TypeError('Config checkpoint cannot precede split verification');
	}
	if (value.status === 'awaiting_manual_wiring' && value.payload.config.activation !== 'manual') {
		throw new TypeError('Only a manual migration can await wiring');
	}
	const rollbackStatus = value.status === 'rollback_prepared' || value.status === 'rolled_back';
	const activatedTerminal =
		value.status === 'completed' || (rollbackStatus && value.checkpoints.baselinePersisted);
	if (activatedTerminal) {
		if (!value.checkpoints.movieVerified || !value.checkpoints.showVerified) {
			throw new TypeError('Activated migration is missing split verification');
		}
		if (value.payload.config.activation === 'managed' && !value.checkpoints.configVerified) {
			throw new TypeError('Activated managed migration is missing config verification');
		}
		if (!value.checkpoints.baselinePersisted || !value.activationEvidence || !value.completedAt) {
			throw new TypeError('Activated migration is missing its durable baseline');
		}
		if (
			(value.payload.config.activation === 'managed' &&
				value.activationEvidence.type !== 'verified_config') ||
			(value.payload.config.activation === 'manual' &&
				value.activationEvidence.type !== 'user_acknowledged')
		) {
			throw new TypeError('Activated migration has invalid activation evidence');
		}
	}
	if (rollbackStatus) {
		if (
			value.payload.config.activation !== 'managed' ||
			(value.backups.config === null &&
				value.payload.config.sourceFingerprint !== MISSING_FILE_FINGERPRINT) ||
			!value.checkpoints.movieVerified ||
			!value.checkpoints.showVerified
		) {
			throw new TypeError('Rollback checkpoint requires a recoverable managed migration');
		}
		if (
			!value.checkpoints.baselinePersisted &&
			(value.completedAt !== null || value.activationEvidence?.type === 'user_acknowledged')
		) {
			throw new TypeError('Recovery rollback cannot carry a completed activation baseline');
		}
	}
	if (value.status === 'rollback_prepared' && value.rolledBackAt !== null) {
		throw new TypeError('Prepared rollback cannot already have a rollback timestamp');
	}
	if (value.status === 'rolled_back' && !value.rolledBackAt) {
		throw new TypeError('Rolled-back migration is missing its timestamp');
	}
	if (
		value.status === 'abandoned' &&
		(value.lastFailure === null || value.completedAt !== null || value.rolledBackAt !== null)
	) {
		throw new TypeError('Abandoned migration must preserve one incomplete failure');
	}
}

export function createKometaMigrationJournal(input: {
	planId: string;
	planDigest: string;
	payload: KometaMigrationPlanPayload;
	now: Date;
}): KometaMigrationJournalV1 {
	const at = input.now.toISOString();
	const journal: KometaMigrationJournalV1 = {
		type: KOMETA_MIGRATION_JOURNAL_KIND,
		version: KOMETA_MIGRATION_JOURNAL_VERSION,
		migrationId: input.payload.migrationId,
		planId: input.planId,
		planDigest: input.planDigest,
		status: 'prepared',
		payload: input.payload,
		checkpoints: {
			movieVerified: false,
			showVerified: false,
			configVerified: false,
			baselinePersisted: false
		},
		backups: { movie: null, show: null, config: null },
		activationEvidence: null,
		lastFailure: null,
		createdAt: at,
		updatedAt: at,
		completedAt: null,
		rolledBackAt: null
	};
	assertKometaMigrationJournal(journal);
	return journal;
}

/** Clone and validate a journal update so callers never persist an impossible checkpoint set. */
export function updateKometaMigrationJournal(
	journal: KometaMigrationJournalV1,
	patch: Partial<Omit<KometaMigrationJournalV1, 'type' | 'version' | 'migrationId' | 'payload'>>,
	now: Date
): KometaMigrationJournalV1 {
	const next = structuredClone(journal);
	Object.assign(next, patch, { updatedAt: now.toISOString() });
	assertKometaMigrationJournal(next);
	return next;
}

export function isKometaMigrationIncomplete(journal: KometaMigrationJournalV1): boolean {
	return journal.status !== 'completed' && journal.status !== 'rolled_back';
}

/**
 * A failed journal is structurally safe to supersede only when it contains no
 * durable evidence that a migration write, activation, or rollback ever began.
 * Callers must also verify that every frozen source still matches disk before
 * replacing it.
 */
export function isEffectlessKometaMigrationFailure(journal: KometaMigrationJournalV1): boolean {
	return (
		(journal.status === 'failed' || journal.status === 'recovery_required') &&
		Object.values(journal.checkpoints).every((checkpoint) => checkpoint === false) &&
		Object.values(journal.backups).every((backup) => backup === null) &&
		journal.activationEvidence === null &&
		journal.completedAt === null &&
		journal.rolledBackAt === null
	);
}

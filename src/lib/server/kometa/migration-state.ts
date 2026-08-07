import type { KometaMigrationJournalV1 } from './migration-journal';
import {
	isEffectlessKometaMigrationFailure,
	isKometaMigrationIncomplete
} from './migration-journal';
import { kometaFileFingerprint } from './plan';

const MISSING_FILE_FINGERPRINT = kometaFileFingerprint(null);

export interface CompletedKometaMigrationBaseline {
	migrationId: string;
	serverInstanceId: string;
	outputDirectory: string;
	metadataPathPrefix: string;
	configPath: string | null;
	configSourceFingerprint: string | null;
	references: { movie: string; show: string };
	activationEvidence: 'verified_config' | 'user_acknowledged';
	completedAt: string;
}

export interface KometaMigrationCollisionState {
	migrationId: string;
	status: KometaMigrationJournalV1['status'];
	serverInstanceId: string;
	outputDirectory: string;
	metadataPathPrefix: string;
	configPath: string | null;
	references: { movie: string; show: string };
	activationEvidence: 'verified_config' | 'user_acknowledged' | null;
	completedAt: string | null;
}

export interface PublicKometaMigrationState {
	migrationId: string;
	status: KometaMigrationJournalV1['status'];
	activation: KometaMigrationJournalV1['payload']['config']['activation'];
	classifiedCount: number;
	ambiguousCount: number;
	references: { movie: string; show: string };
	files: {
		movie: { physicalPath: string; configReference: string };
		show: { physicalPath: string; configReference: string };
	};
	manualSnippet: string | null;
	manualSnippetFingerprint: string | null;
	configBackup: KometaMigrationJournalV1['backups']['config'];
	lastFailure: KometaMigrationJournalV1['lastFailure'];
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
	scopeMatches: boolean;
	frozenScope: {
		serverInstanceId: string;
		serverName: string;
		outputDirectory: string;
		configPath: string | null;
		mode: KometaMigrationJournalV1['payload']['config']['mode'];
		metadataPathPrefix: string;
	};
	canResume: boolean;
	canRestartPreview: boolean;
	canAbandon: boolean;
	requiresAcknowledgment: boolean;
	canRollback: boolean;
	recoveryGuidance:
		| 'manual_safe_to_abandon'
		| 'source_safe_to_abandon'
		| 'proposed_safe_to_rollback'
		| 'divergent_manual_intervention'
		| null;
}

export interface PublicKometaMigrationStateOptions {
	/** True only after the caller has revalidated the frozen server/config scope. */
	scopeMatches?: boolean;
	canAbandon?: boolean;
	canRecoveryRollback?: boolean;
	recoveryGuidance?: PublicKometaMigrationState['recoveryGuidance'];
}

/** Return only the activation fields needed by the Kometa collision guard. */
export function completedKometaMigrationBaseline(
	journal: KometaMigrationJournalV1 | null
): CompletedKometaMigrationBaseline | null {
	if (
		!journal ||
		journal.status !== 'completed' ||
		!journal.completedAt ||
		!journal.activationEvidence
	) {
		return null;
	}
	return {
		migrationId: journal.migrationId,
		serverInstanceId: journal.payload.serverInstanceId,
		outputDirectory: journal.payload.outputDirectory,
		metadataPathPrefix: journal.payload.metadataPathPrefix,
		configPath: journal.payload.config.path,
		configSourceFingerprint: journal.payload.config.sourceFingerprint,
		references: journal.payload.references,
		activationEvidence: journal.activationEvidence.type,
		completedAt: journal.completedAt
	};
}

/** Return the full safe lifecycle projection needed to block in-flight exports. */
export function kometaMigrationCollisionState(
	journal: KometaMigrationJournalV1 | null
): KometaMigrationCollisionState | null {
	if (!journal) return null;
	return {
		migrationId: journal.migrationId,
		status: journal.status,
		serverInstanceId: journal.payload.serverInstanceId,
		outputDirectory: journal.payload.outputDirectory,
		metadataPathPrefix: journal.payload.metadataPathPrefix,
		configPath: journal.payload.config.path,
		references: journal.payload.references,
		activationEvidence: journal.activationEvidence?.type ?? null,
		completedAt: journal.completedAt
	};
}

/** Redact exact YAML bytes and provider URLs before serializing manager state. */
export function publicKometaMigrationState(
	journal: KometaMigrationJournalV1 | null,
	options: PublicKometaMigrationStateOptions = {}
): PublicKometaMigrationState | null {
	if (!journal) return null;
	const scopeMatches = options.scopeMatches === true;
	return {
		migrationId: journal.migrationId,
		status: journal.status,
		activation: journal.payload.config.activation,
		classifiedCount: journal.payload.display.classified.length,
		ambiguousCount: journal.payload.display.ambiguous.length,
		references: journal.payload.references,
		files: {
			movie: {
				physicalPath: journal.payload.files.movie.path,
				configReference: journal.payload.references.movie
			},
			show: {
				physicalPath: journal.payload.files.show.path,
				configReference: journal.payload.references.show
			}
		},
		manualSnippet: journal.payload.manualSnippet,
		manualSnippetFingerprint: journal.payload.manualSnippetFingerprint,
		configBackup: journal.backups.config,
		lastFailure: journal.lastFailure,
		createdAt: journal.createdAt,
		updatedAt: journal.updatedAt,
		completedAt: journal.completedAt,
		scopeMatches,
		frozenScope: {
			serverInstanceId: journal.payload.serverInstanceId,
			serverName: journal.payload.serverName,
			outputDirectory: journal.payload.outputDirectory,
			configPath: journal.payload.config.path,
			mode: journal.payload.config.mode,
			metadataPathPrefix: journal.payload.metadataPathPrefix
		},
		canResume:
			scopeMatches &&
			isKometaMigrationIncomplete(journal) &&
			journal.status !== 'abandoned' &&
			journal.status !== 'recovery_required' &&
			journal.status !== 'awaiting_manual_wiring' &&
			journal.status !== 'rollback_prepared',
		canRestartPreview:
			scopeMatches &&
			(isEffectlessKometaMigrationFailure(journal) || journal.status === 'abandoned'),
		canAbandon: scopeMatches && options.canAbandon === true,
		requiresAcknowledgment: journal.status === 'awaiting_manual_wiring',
		canRollback:
			scopeMatches &&
			(journal.status === 'completed' ||
				journal.status === 'rollback_prepared' ||
				options.canRecoveryRollback === true) &&
			journal.payload.config.activation === 'managed' &&
			(journal.backups.config !== null ||
				journal.payload.config.sourceFingerprint === MISSING_FILE_FINGERPRINT),
		recoveryGuidance: scopeMatches ? (options.recoveryGuidance ?? null) : null
	};
}

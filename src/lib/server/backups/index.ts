import { existsSync } from 'node:fs';
import { env } from '$env/dynamic/private';
import { version } from '$lib/version';
import { resolveDataPaths } from '$lib/server/data-paths';
import { resolveConfig } from '$lib/server/config';
import { databaseClient, db } from '$lib/server/db';
import { getEncryptionKey } from '$lib/server/secrets/key';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { OperationPlanError } from '$lib/server/plans/operation-plan-store';
import { drainJobQueue } from '$lib/server/jobs/runner';
import {
	enterMaintenanceMode,
	leaveMaintenanceMode,
	maintenanceMode
} from '$lib/server/maintenance';
import {
	createBackupBundle,
	type BackupKeySource,
	type BackupRecordStore,
	type CreatedBackupBundle
} from './create';
import {
	deleteBackupRecord,
	prepareBackupExport,
	runConfiguredBackupRetention,
	type BackupRetentionResult,
	type DeleteBackupConfirmation,
	type DeletedBackupResult,
	type PreparedBackupExport
} from './management';
import {
	findBackupRecord,
	listBackupInventory,
	resolveManagedBundlePath,
	validateBackupRecord,
	type BackupInventoryContext,
	type BackupInventoryItem
} from './inventory';
import { loadSupportedMigrations } from './migration-catalog';
import {
	inspectExternalPaths,
	inspectRestoreDatabase,
	inspectRestoreStorage
} from './restore-inspection';
import {
	createRestorePreflightService,
	resolveRestoreKey,
	type RestorePreflightResult
} from './restore-preflight';
import { createRestorePreflightRecordStore } from './restore-records';
import { BackupServiceError, asBackupServiceError } from './errors';
import {
	createRestoreConfirmationService,
	RestoreConfirmationError,
	type RestoreConfirmationRequest,
	type RestoreConfirmationResult
} from './restore-orchestrator';
import { stageApplicationRestore } from './restore-staging';
import type { BackupTrigger } from './manifest';
import {
	getBackupRetentionPolicy,
	updateBackupRetentionPolicy,
	type BackupRetentionPolicy,
	type BackupRetentionPolicyUpdate
} from './policy';
import { createBackupRecordStore } from './records';

const recordStore: BackupRecordStore = createBackupRecordStore(db);
const restoreRecordStore = createRestorePreflightRecordStore(db);

function effectiveKeySource(dataPaths: ReturnType<typeof resolveDataPaths>): BackupKeySource {
	const key = getEncryptionKey();
	if (env.APP_SECRET && env.APP_SECRET !== '') {
		return { mode: 'environment', key };
	}
	return existsSync(dataPaths.appKeyFile)
		? { mode: 'generated', path: dataPaths.appKeyFile }
		: { mode: 'none' };
}

export interface CreateApplicationBackupOptions {
	trigger?: BackupTrigger;
	protected?: boolean;
}

export type ApplicationBackupRetentionOutcome =
	| ({ ok: true } & BackupRetentionResult)
	| ({ ok: false; errorCode: 'retention_partial_failure' } & BackupRetentionResult)
	| { ok: false; errorCode: 'retention_failed' };

export interface CreatedApplicationBackup extends CreatedBackupBundle {
	retention: ApplicationBackupRetentionOutcome;
}

function applicationBackupContext(
	dataPaths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE)
): BackupInventoryContext {
	return { database: db, dataPaths };
}

async function validatedRestoreBackup(
	context: BackupInventoryContext,
	dataPaths: ReturnType<typeof resolveDataPaths>,
	id: string
) {
	const validation = await validateBackupRecord(context, id);
	const record = await findBackupRecord(context, id);
	return {
		record,
		validation: validation.result,
		bundleDirectory: resolveManagedBundlePath(dataPaths, record.bundleName)
	};
}

/** Create one application backup, then prune only policy-eligible prior bundles. */
export async function createApplicationBackup(
	options: CreateApplicationBackupOptions = {}
): Promise<CreatedApplicationBackup> {
	// Resolving config first materializes the generated key when encrypted persisted
	// settings need it, ensuring the matching key is included in the bundle.
	const config = await resolveConfig();
	const dataPaths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);

	const created = await createBackupBundle({
		dataPaths,
		databaseClient,
		recordStore,
		appVersion: version,
		trigger: options.trigger ?? 'manual',
		protected: options.protected,
		keySource: effectiveKeySource(dataPaths),
		externalPaths: [
			{
				kind: 'kometa_assets',
				path: config.kometaAssetsDir,
				expectedType: 'directory'
			},
			{
				kind: 'kometa_config',
				path: config.kometaConfigPath,
				expectedType: 'file'
			}
		]
	});
	let retention: ApplicationBackupRetentionOutcome;
	try {
		const result = await runConfiguredBackupRetention(applicationBackupContext(dataPaths));
		retention =
			result.failedIds.length === 0
				? { ok: true, ...result }
				: { ok: false, errorCode: 'retention_partial_failure', ...result };
	} catch {
		// The new bundle is already complete and must remain a reported success.
		retention = { ok: false, errorCode: 'retention_failed' };
	}
	return { ...created, retention };
}

export async function listApplicationBackups(): Promise<BackupInventoryItem[]> {
	return listBackupInventory(applicationBackupContext());
}

export async function validateApplicationBackup(id: string): Promise<{
	item: BackupInventoryItem;
	issues: string[];
}> {
	const validation = await validateBackupRecord(applicationBackupContext(), id);
	return { item: validation.item, issues: validation.result.issues };
}

export async function deleteApplicationBackup(
	id: string,
	confirmation: DeleteBackupConfirmation
): Promise<DeletedBackupResult> {
	return deleteBackupRecord(applicationBackupContext(), id, confirmation);
}

export async function exportApplicationBackup(
	id: string,
	confirmSecretBearing: boolean
): Promise<PreparedBackupExport> {
	return prepareBackupExport(applicationBackupContext(), id, confirmSecretBearing);
}

/** Run every read-only restore check and issue confirmation only for an exact valid preview. */
export async function previewApplicationRestore(backupId: string): Promise<RestorePreflightResult> {
	try {
		const dataPaths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);
		const context = applicationBackupContext(dataPaths);
		const currentKey = env.APP_SECRET
			? { mode: 'environment' as const, key: getEncryptionKey() }
			: { mode: 'generated' as const, key: null };
		const service = createRestorePreflightService({
			dataPaths,
			async validateBackup(id) {
				return validatedRestoreBackup(context, dataPaths, id);
			},
			resolveKey: (directory, manifest) => resolveRestoreKey(directory, manifest, currentKey),
			inspectDatabase: inspectRestoreDatabase,
			inspectStorage: inspectRestoreStorage,
			inspectExternal: inspectExternalPaths,
			loadMigrations: loadSupportedMigrations,
			createPlan: (input) => operationPlanStore.create(input),
			recordStore: restoreRecordStore
		});
		return await service.preview(backupId);
	} catch (error) {
		throw asBackupServiceError(error, 'restore_preflight_failed');
	}
}

function confirmationError(error: unknown): BackupServiceError {
	if (error instanceof BackupServiceError) return error;
	if (error instanceof OperationPlanError) {
		const code =
			error.code === 'plan_expired'
				? 'restore_confirmation_expired'
				: error.code === 'plan_consumed'
					? 'restore_confirmation_used'
					: error.code === 'plan_stale'
						? 'restore_state_changed'
						: 'restore_confirmation_invalid';
		return new BackupServiceError(code, error.code === 'plan_not_found' ? 404 : 409);
	}
	if (error instanceof RestoreConfirmationError) {
		const status = error.code === 'restore_drain_timeout' ? 503 : 409;
		return new BackupServiceError(error.code, status, { cause: error });
	}
	return new BackupServiceError('restore_staging_failed', 500, { cause: error });
}

/** Consume an exact preflight and prepare the recoverable early-boot replacement. */
export async function confirmApplicationRestore(
	request: RestoreConfirmationRequest
): Promise<RestoreConfirmationResult> {
	const dataPaths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);
	const context = applicationBackupContext(dataPaths);
	const service = createRestoreConfirmationService({
		consumePlan: (planId, digest) =>
			operationPlanStore.consume(planId, { kind: 'application_restore', digest }),
		validateBackup: (id) => validatedRestoreBackup(context, dataPaths, id),
		enterMaintenance() {
			if (maintenanceMode()) throw new RestoreConfirmationError('restore_state_changed');
			enterMaintenanceMode('application_restore');
		},
		leaveMaintenance: () => leaveMaintenanceMode('application_restore'),
		drainJobs: () => drainJobQueue(),
		createSafetyBackup: () => createApplicationBackup({ trigger: 'pre_restore', protected: true }),
		stage: ({ bundleDirectory, manifest, restore }) =>
			stageApplicationRestore({ dataPaths, bundleDirectory, manifest, restore }),
		recordStore: restoreRecordStore
	});
	try {
		return await service.confirm(request);
	} catch (error) {
		throw confirmationError(error);
	}
}

export async function listApplicationRestoreHistory() {
	const rows = await restoreRecordStore.list(20);
	return rows.map((row) => ({
		id: row.id,
		backupId: row.backupId,
		safetyBackupId: row.safetyBackupId,
		status: row.status,
		report: row.report,
		errorCode: row.errorCode,
		createdAt: row.createdAt.toISOString(),
		completedAt: row.completedAt?.toISOString() ?? null
	}));
}

export async function readApplicationBackupRetentionPolicy(): Promise<BackupRetentionPolicy> {
	return getBackupRetentionPolicy(db);
}

export async function saveApplicationBackupRetentionPolicy(
	update: BackupRetentionPolicyUpdate
): Promise<BackupRetentionPolicy> {
	return updateBackupRetentionPolicy(db, update);
}

export type { BackupKeySource, BackupRecordStore, CreatedBackupBundle } from './create';
export { BackupServiceError } from './errors';
export type { BackupServiceErrorCode } from './errors';
export type {
	BackupRetentionResult,
	DeleteBackupConfirmation,
	DeletedBackupResult,
	PreparedBackupExport
} from './management';
export type { BackupInventoryItem } from './inventory';
export type {
	RestoreConfirmationBinding,
	RestorePreflightBlockingCode,
	RestorePreflightReport,
	RestorePreflightResult,
	RestorePreflightWarning
} from './restore-preflight';
export type { RestoreConfirmationRequest, RestoreConfirmationResult } from './restore-orchestrator';
export type { BackupKeyMode, BackupManifestV1, BackupTrigger } from './manifest';
export type { BackupRetentionPolicy, BackupRetentionPolicyUpdate } from './policy';

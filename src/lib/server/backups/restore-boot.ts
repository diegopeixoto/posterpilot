import { env } from '$env/dynamic/private';
import { databaseClient, db } from '$lib/server/db';
import { inspectScopeIntegrity } from '$lib/server/db/scope-integrity';
import type { PendingRestoreResult } from '$lib/server/db/pending-restore';
import { finalizeAppliedPendingRestore } from '$lib/server/db/pending-restore';
import { resolveDataPaths } from '$lib/server/data-paths';
import { resolveConfig } from '$lib/server/config';
import { getEncryptionKey } from '$lib/server/secrets/key';
import { createRestorePreflightRecordStore } from './restore-records';
import {
	inspectExternalPaths,
	inspectRestoreDatabase,
	inspectRestoreStorage
} from './restore-inspection';
import { reconcileBackupInventory, type BackupInventoryContext } from './inventory';

const restoreRecords = createRestorePreflightRecordStore(db);

async function namespaceIntegrity() {
	const result = await inspectScopeIntegrity(databaseClient);
	return {
		ok: result.ok,
		orphanedRows: result.violationCount,
		violations: result.violations
	};
}

async function localReadiness(paths: ReturnType<typeof resolveDataPaths>) {
	if (!paths.databaseFile) throw new Error('restore readiness requires a local database');
	const [database, storage, namespace, config] = await Promise.all([
		inspectRestoreDatabase(paths.databaseFile, getEncryptionKey()),
		inspectRestoreStorage(paths, 0, 0, false),
		namespaceIntegrity(),
		resolveConfig()
	]);
	const externalPaths = await inspectExternalPaths([
		{
			kind: 'kometa_assets',
			path: config.kometaAssetsDir,
			expectedType: 'directory',
			reachable: true
		},
		{
			kind: 'kometa_config',
			path: config.kometaConfigPath,
			expectedType: 'file',
			reachable: true
		}
	]);
	const blocking: string[] = [];
	if (database.status !== 'ok') blocking.push(`database_${database.status}`);
	if (database.secretStatus === 'key_missing' || database.secretStatus === 'invalid') {
		blocking.push(`secret_${database.secretStatus}`);
	}
	if (!namespace.ok) blocking.push('server_namespace_invalid');
	if (storage.paths.database !== 'writable' || storage.paths.backup_storage !== 'writable') {
		blocking.push('required_path_unwritable');
	}
	return {
		status: blocking.length === 0 ? ('ready' as const) : ('blocked' as const),
		blocking,
		database: {
			status: database.status,
			secretStatus: database.secretStatus,
			encryptedSecretCount: database.encryptedSecretCount
		},
		storage,
		namespace,
		externalPaths
	};
}

async function reconcile(paths: ReturnType<typeof resolveDataPaths>) {
	const context: BackupInventoryContext = { database: db, dataPaths: paths };
	await reconcileBackupInventory(context);
}

/** Finish or report the boot phase before request handling can begin. */
export async function finalizeApplicationRestoreBoot(result: PendingRestoreResult): Promise<void> {
	if (result.status === 'none' || !('restore' in result) || !result.restore) return;
	const paths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);
	const restore = result.restore;
	await reconcile(paths);

	if (result.status === 'applied') {
		const readiness = await localReadiness(paths);
		if (readiness.status !== 'ready') {
			// Keep pending + rollback markers. Boot fails closed; the next startup rolls
			// back before opening SQLite and records that outcome against the old state.
			throw new Error(`restore_readiness_failed:${readiness.blocking.join(',')}`);
		}
		await restoreRecords.finalizeBootOutcome({
			id: restore.restoreId,
			backupId: restore.backupId,
			safetyBackupId: restore.safetyBackupId,
			previewChecksum: restore.previewChecksum,
			status: 'completed',
			report: { readiness },
			errorCode: null,
			createdAt: new Date(restore.createdAt),
			completedAt: new Date()
		});
		finalizeAppliedPendingRestore(paths, restore.restoreId);
		return;
	}

	const rolledBack = result.status === 'rolled_back';
	await restoreRecords.finalizeBootOutcome({
		id: restore.restoreId,
		backupId: restore.backupId,
		safetyBackupId: restore.safetyBackupId,
		previewChecksum: restore.previewChecksum,
		status: rolledBack ? 'rolled_back' : 'failed',
		report: {
			readiness: {
				status: rolledBack ? 'rolled_back' : 'rejected',
				errorCode: rolledBack ? 'restore_rolled_back' : 'restore_rejected'
			}
		},
		errorCode: rolledBack ? 'restore_rolled_back' : 'restore_rejected',
		createdAt: new Date(restore.createdAt),
		completedAt: new Date()
	});
}

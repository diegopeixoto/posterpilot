import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { eq, ne } from 'drizzle-orm';
import { backupRecords } from '$lib/server/db/schema';
import { BackupServiceError, asBackupServiceError } from './errors';
import { backupExportFilename, createBackupTarArchive } from './export';
import {
	findBackupRecord,
	isValidatedStatus,
	reconcileBackupInventory,
	resolveManagedBundlePath,
	validateBackupRecord,
	type BackupInventoryContext,
	type BackupInventoryItem,
	type BackupRecord
} from './inventory';
import {
	getBackupRetentionPolicy,
	selectRetentionCandidates,
	type BackupRetentionPolicy
} from './policy';

export interface DeleteBackupConfirmation {
	confirm: boolean;
	confirmProtected?: boolean;
}

export interface DeletedBackupResult {
	id: string;
	deleted: true;
}

export interface BackupRetentionResult {
	policy: BackupRetentionPolicy;
	deletedIds: string[];
	skippedIds: string[];
	failedIds: string[];
}

export interface PreparedBackupExport {
	item: BackupInventoryItem;
	filename: string;
	contentLength: number;
	stream: Readable;
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function physicallyDeleteRecord(
	context: BackupInventoryContext,
	record: BackupRecord
): Promise<DeletedBackupResult> {
	const source = resolveManagedBundlePath(context.dataPaths, record.bundleName);
	// Stable quarantine name lets a retry finish cleanup after a prior interrupted deletion.
	const quarantine = join(context.dataPaths.backupsDirectory, `.deleting-${record.bundleName}`);
	try {
		await rm(quarantine, { recursive: true, force: true });
		await rename(source, quarantine);
	} catch (error) {
		if (!isMissing(error)) {
			throw new BackupServiceError('backup_delete_failed', 500, { cause: error });
		}
	}

	try {
		await rm(quarantine, { recursive: true, force: true });
		const result = await context.database
			.update(backupRecords)
			.set({ status: 'deleted', deletedAt: new Date() })
			.where(eq(backupRecords.id, record.id));
		if (result.rowsAffected !== 1) {
			throw new Error('backup inventory row was not updated');
		}
		return { id: record.id, deleted: true };
	} catch (error) {
		throw asBackupServiceError(error, 'backup_delete_failed');
	}
}

/** User-facing deletion always requires confirmation, plus a second protected confirmation. */
export async function deleteBackupRecord(
	context: BackupInventoryContext,
	id: string,
	confirmation: DeleteBackupConfirmation
): Promise<DeletedBackupResult> {
	const record = await findBackupRecord(context, id);
	if (!confirmation.confirm) {
		throw new BackupServiceError('backup_delete_confirmation_required', 409);
	}
	if (record.protected && confirmation.confirmProtected !== true) {
		throw new BackupServiceError('protected_backup_confirmation_required', 409);
	}
	return physicallyDeleteRecord(context, record);
}

async function deleteRetentionCandidate(
	context: BackupInventoryContext,
	record: BackupRecord
): Promise<boolean> {
	// Revalidate immediately so stale inventory cannot prune a replaced/tampered directory.
	const validation = await validateBackupRecord(context, record.id);
	if (!isValidatedStatus(validation.result.status)) return false;
	// Re-read after validation so a newly protected record can never be pruned.
	const current = await findBackupRecord(context, record.id);
	if (current.protected || !isValidatedStatus(current.validationStatus)) return false;
	await physicallyDeleteRecord(context, current);
	return true;
}

/** Apply the configured policy after a successful backup; failures never undo that backup. */
export async function runConfiguredBackupRetention(
	context: BackupInventoryContext,
	now = new Date()
): Promise<BackupRetentionResult> {
	const policy = await getBackupRetentionPolicy(context.database);
	await reconcileBackupInventory(context);
	const records = await context.database
		.select()
		.from(backupRecords)
		.where(ne(backupRecords.status, 'deleted'));
	const candidates = selectRetentionCandidates(records, policy, now);
	const result: BackupRetentionResult = {
		policy,
		deletedIds: [],
		skippedIds: [],
		failedIds: []
	};
	for (const candidate of candidates) {
		try {
			if (await deleteRetentionCandidate(context, candidate)) {
				result.deletedIds.push(candidate.id);
			} else {
				result.skippedIds.push(candidate.id);
			}
		} catch {
			result.failedIds.push(candidate.id);
		}
	}
	return result;
}

/** Validate once more immediately before constructing a secret-bearing export stream. */
export async function prepareBackupExport(
	context: BackupInventoryContext,
	id: string,
	confirmSecretBearing: boolean
): Promise<PreparedBackupExport> {
	if (!confirmSecretBearing) {
		throw new BackupServiceError('backup_export_confirmation_required', 409);
	}
	const { item, result } = await validateBackupRecord(context, id);
	if (!isValidatedStatus(result.status) || !result.manifest || !result.manifestChecksum) {
		throw new BackupServiceError('backup_not_exportable', 409);
	}
	try {
		const record = await findBackupRecord(context, id);
		const archive = await createBackupTarArchive(
			resolveManagedBundlePath(context.dataPaths, record.bundleName),
			result.manifest,
			result.manifestChecksum
		);
		return {
			item,
			filename: backupExportFilename(id),
			contentLength: archive.contentLength,
			stream: archive.stream
		};
	} catch (error) {
		throw asBackupServiceError(error, 'backup_export_failed');
	}
}

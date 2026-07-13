import { eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { backupRecords } from '$lib/server/db/schema';
import type {
	BackupRecordBase,
	BackupRecordCompleted,
	BackupRecordFailed,
	BackupRecordStore
} from './create';
import type { BackupManifestV1 } from './manifest';

function manifestRecord(manifest: BackupManifestV1): Record<string, unknown> {
	return manifest as unknown as Record<string, unknown>;
}

async function updateFailedRecord(
	database: LibSQLDatabase<typeof schema>,
	record: BackupRecordFailed
): Promise<void> {
	const result = await database
		.update(backupRecords)
		.set({
			status: 'failed',
			validationStatus: 'invalid',
			validatedAt: record.completedAt,
			errorCode: record.errorCode,
			error: record.error,
			completedAt: record.completedAt
		})
		.where(eq(backupRecords.id, record.id));
	if (result.rowsAffected !== 1) throw new Error('backup failure record was not found');
}

/** Schema-backed lifecycle store shared by manual, scheduled, and safety backups. */
export function createBackupRecordStore(
	database: LibSQLDatabase<typeof schema>
): BackupRecordStore {
	return {
		async markCreating(record: BackupRecordBase): Promise<void> {
			await database.insert(backupRecords).values({
				id: record.id,
				trigger: record.trigger,
				status: 'creating',
				bundleName: record.bundleName,
				storagePath: record.storagePath,
				protected: record.protected,
				createdAt: record.createdAt
			});
		},

		async markCompleted(record: BackupRecordCompleted): Promise<void> {
			const result = await database
				.update(backupRecords)
				.set({
					status: 'completed',
					manifest: manifestRecord(record.manifest),
					appVersion: record.appVersion,
					schemaVersion: record.schemaVersion,
					keyMode: record.keyMode,
					keyFingerprint: record.keyFingerprint,
					sizeBytes: record.sizeBytes,
					checksum: record.checksum,
					validationStatus: 'valid',
					validatedAt: record.completedAt,
					errorCode: null,
					error: null,
					completedAt: record.completedAt
				})
				.where(eq(backupRecords.id, record.id));
			if (result.rowsAffected !== 1) throw new Error('backup completion record was not found');
		},

		async markFailed(record: BackupRecordFailed, recordExists: boolean): Promise<void> {
			if (recordExists) {
				await updateFailedRecord(database, record);
				return;
			}
			const existing = (
				await database
					.select({ bundleName: backupRecords.bundleName, storagePath: backupRecords.storagePath })
					.from(backupRecords)
					.where(eq(backupRecords.id, record.id))
					.limit(1)
			)[0];
			if (existing) {
				if (
					existing.bundleName !== record.bundleName ||
					existing.storagePath !== record.storagePath
				) {
					throw new Error('backup record id collision');
				}
				await updateFailedRecord(database, record);
				return;
			}
			await database.insert(backupRecords).values({
				id: record.id,
				trigger: record.trigger,
				status: 'failed',
				bundleName: record.bundleName,
				storagePath: record.storagePath,
				protected: record.protected,
				validationStatus: 'invalid',
				errorCode: record.errorCode,
				error: record.error,
				createdAt: record.createdAt,
				completedAt: record.completedAt,
				validatedAt: record.completedAt
			});
		}
	};
}

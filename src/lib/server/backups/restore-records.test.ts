import { beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import { backupRecords, operationPlans, restoreRecords } from '$lib/server/db/schema';
import { createRestorePreflightRecordStore } from './restore-records';

const client = createClient({ url: ':memory:' });
const database = drizzle(client, { schema });

beforeEach(async () => {
	await migrate(database, { migrationsFolder: './drizzle' });
	await database.delete(restoreRecords);
	await database.delete(operationPlans);
	await database.delete(backupRecords);
	await database.insert(backupRecords).values([
		{
			id: 'backup-1',
			trigger: 'manual',
			status: 'completed',
			bundleName: 'bundle-1',
			storagePath: '/redacted/one',
			protected: true
		},
		{
			id: 'safety-1',
			trigger: 'pre_restore',
			status: 'completed',
			bundleName: 'bundle-safety',
			storagePath: '/redacted/safety',
			protected: true
		}
	]);
	await database.insert(operationPlans).values({
		id: 'plan-1',
		kind: 'application_restore',
		payload: '{}',
		digest: 'a'.repeat(64),
		expiresAt: new Date('2026-07-10T21:15:00.000Z')
	});
});

describe('restore lifecycle records', () => {
	it('moves from exact preview to pending restart and a completed boot report', async () => {
		const store = createRestorePreflightRecordStore(database);
		const createdAt = new Date('2026-07-10T21:00:00.000Z');
		await store.createPreview({
			id: 'restore-1',
			backupId: 'backup-1',
			operationPlanId: 'plan-1',
			previewChecksum: 'b'.repeat(64),
			report: { restorable: true },
			createdAt
		});
		await store.markPendingRestart('restore-1', 'safety-1', {
			orchestration: { status: 'pending_restart' }
		});
		expect(await store.find('restore-1')).toMatchObject({
			status: 'pending_restart',
			safetyBackupId: 'safety-1',
			operationPlanId: 'plan-1'
		});

		await store.finalizeBootOutcome({
			id: 'restore-1',
			backupId: 'backup-1',
			safetyBackupId: 'safety-1',
			previewChecksum: 'b'.repeat(64),
			status: 'completed',
			report: { readiness: { status: 'ready' } },
			errorCode: null,
			createdAt,
			completedAt: new Date('2026-07-10T21:02:00.000Z')
		});
		expect(await store.find('restore-1')).toMatchObject({
			status: 'completed',
			safetyBackupId: 'safety-1',
			operationPlanId: null,
			report: { readiness: { status: 'ready' } },
			errorCode: null
		});
	});

	it('can recreate a rolled-back outcome when the restored database lacked the preview row', async () => {
		const store = createRestorePreflightRecordStore(database);
		await store.finalizeBootOutcome({
			id: 'restore-2',
			backupId: 'backup-1',
			safetyBackupId: 'safety-1',
			previewChecksum: 'c'.repeat(64),
			status: 'rolled_back',
			report: { readiness: { status: 'rolled_back' } },
			errorCode: 'restore_rolled_back',
			createdAt: new Date('2026-07-10T21:00:00.000Z'),
			completedAt: new Date('2026-07-10T21:03:00.000Z')
		});
		expect(await store.find('restore-2')).toMatchObject({
			status: 'rolled_back',
			operationPlanId: null,
			errorCode: 'restore_rolled_back'
		});
	});
});

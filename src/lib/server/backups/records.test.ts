import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import type { BackupRecordBase, BackupRecordFailed } from './create';
import { buildBackupManifest } from './manifest';
import { createBackupRecordStore } from './records';

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;

const createdAt = new Date('2026-07-10T12:00:00.000Z');

function base(id: string): BackupRecordBase {
	return {
		id,
		trigger: 'manual',
		bundleName: `${id}-bundle`,
		storagePath: `/data/backups/${id}-bundle`,
		protected: true,
		createdAt
	};
}

function failure(record: BackupRecordBase): BackupRecordFailed {
	return {
		...record,
		errorCode: 'snapshot_failed',
		error: 'Backup creation failed (snapshot_failed).',
		completedAt: new Date('2026-07-10T12:01:00.000Z')
	};
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-backup-records-'));
	client = createClient({ url: `file:${join(directory, 'records.db')}` });
	database = drizzle(client, { schema });
	await client.execute(`
		CREATE TABLE backup_records (
			id TEXT PRIMARY KEY NOT NULL,
			trigger TEXT NOT NULL,
			status TEXT DEFAULT 'creating' NOT NULL,
			bundle_name TEXT NOT NULL UNIQUE,
			storage_path TEXT NOT NULL,
			manifest TEXT,
			app_version TEXT,
			schema_version TEXT,
			key_mode TEXT,
			key_fingerprint TEXT,
			size_bytes INTEGER,
			checksum TEXT,
			protected INTEGER DEFAULT 0 NOT NULL,
			validation_status TEXT DEFAULT 'unknown' NOT NULL,
			error_code TEXT,
			error TEXT,
			created_at INTEGER NOT NULL,
			completed_at INTEGER,
			validated_at INTEGER,
			deleted_at INTEGER
		)
	`);
});

afterEach(() => {
	client.close();
	rmSync(directory, { recursive: true, force: true });
});

describe('createBackupRecordStore', () => {
	it('persists creating and completed lifecycle metadata through the backup schema', async () => {
		const store = createBackupRecordStore(database);
		const record = base('backup-complete');
		await store.markCreating(record);
		const manifest = buildBackupManifest({
			backupId: record.id,
			trigger: record.trigger,
			createdAt: createdAt.toISOString(),
			appVersion: '1.2.3',
			schemaVersion: '123',
			snapshot: { method: 'vacuum_into', checkpointFallback: false },
			key: { mode: 'environment', fingerprint: 'a'.repeat(64), included: false },
			files: [{ path: 'posterpilot.db', role: 'database', sizeBytes: 10, sha256: 'b'.repeat(64) }],
			externalPaths: []
		});
		await store.markCompleted({
			id: record.id,
			manifest,
			appVersion: '1.2.3',
			schemaVersion: '123',
			keyMode: 'environment',
			keyFingerprint: 'a'.repeat(64),
			sizeBytes: 100,
			checksum: 'c'.repeat(64),
			completedAt: new Date('2026-07-10T12:01:00.000Z')
		});

		const row = (await client.execute('SELECT * FROM backup_records')).rows[0];
		expect(row?.status).toBe('completed');
		expect(row?.trigger).toBe('manual');
		expect(row?.protected).toBe(1);
		expect(row?.key_mode).toBe('environment');
		expect(row?.checksum).toBe('c'.repeat(64));
		expect(row?.validation_status).toBe('valid');
		expect(row?.validated_at).not.toBeNull();
		expect(JSON.parse(String(row?.manifest))).toEqual(manifest);
	});

	it('inserts or updates sanitized failures without overwriting an id collision', async () => {
		const store = createBackupRecordStore(database);
		const existing = base('backup-existing');
		await store.markCreating(existing);
		await store.markFailed(failure(existing), false);

		const fresh = base('backup-fresh-failure');
		await store.markFailed(failure(fresh), false);

		await expect(
			store.markFailed(
				failure({
					...existing,
					bundleName: 'different-bundle',
					storagePath: '/data/backups/different-bundle'
				}),
				false
			)
		).rejects.toThrow('backup record id collision');

		const rows = await client.execute(
			'SELECT id, status, validation_status, error_code, bundle_name FROM backup_records ORDER BY id'
		);
		expect(
			rows.rows.map((row) => [
				row.id,
				row.status,
				row.validation_status,
				row.error_code,
				row.bundle_name
			])
		).toEqual([
			['backup-existing', 'failed', 'invalid', 'snapshot_failed', 'backup-existing-bundle'],
			[
				'backup-fresh-failure',
				'failed',
				'invalid',
				'snapshot_failed',
				'backup-fresh-failure-bundle'
			]
		]);
	});
});

import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPaths } from '$lib/server/data-paths';
import {
	createBackupBundle,
	type BackupRecordBase,
	type BackupRecordCompleted,
	type BackupRecordFailed,
	type BackupRecordStore
} from './create';
import { fingerprintEncryptionKey, sha256Bytes, type BackupManifestV1 } from './manifest';

class MemoryRecordStore implements BackupRecordStore {
	creating: BackupRecordBase[] = [];
	completed: BackupRecordCompleted[] = [];
	failed: Array<{ record: BackupRecordFailed; recordExists: boolean }> = [];
	failCompletion = false;

	async markCreating(record: BackupRecordBase): Promise<void> {
		this.creating.push(record);
	}

	async markCompleted(record: BackupRecordCompleted): Promise<void> {
		if (this.failCompletion) throw new Error('record unavailable');
		this.completed.push(record);
	}

	async markFailed(record: BackupRecordFailed, recordExists: boolean): Promise<void> {
		this.failed.push({ record, recordExists });
	}
}

let directory: string;
let databasePath: string;
let keyPath: string;
let client: Client;
let records: MemoryRecordStore;

async function seedDatabase(): Promise<void> {
	await client.execute('PRAGMA foreign_keys=ON');
	await client.execute('PRAGMA journal_mode=WAL');
	await client.execute('PRAGMA wal_autocheckpoint=0');
	await client.execute(
		'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)'
	);
	await client.execute(
		"INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('migration-hash', 123456789)"
	);
	await client.execute('CREATE TABLE library_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
	await client.execute({ sql: 'INSERT INTO library_items (title) VALUES (?)', args: ['Arrival'] });
	await client.execute(
		'CREATE TABLE http_cache (url TEXT PRIMARY KEY, body TEXT, fetched_at INTEGER)'
	);
	await client.execute(
		"INSERT INTO http_cache VALUES ('https://api.test?api_key=backup-secret', '{}', 1)"
	);
	await client.execute(
		'CREATE TABLE thumbnail_cache (url_hash TEXT PRIMARY KEY, url TEXT NOT NULL)'
	);
	await client.execute(
		"INSERT INTO thumbnail_cache VALUES ('hash', 'https://media.test/image?X-Plex-Token=backup-secret')"
	);
	await client.execute('CREATE TABLE operation_plans (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
	await client.execute(
		'INSERT INTO operation_plans VALUES (\'plan\', \'{"token":"backup-secret"}\')'
	);
	await client.execute(
		'CREATE TABLE revision_groups (id TEXT PRIMARY KEY, plan_id TEXT REFERENCES operation_plans(id) ON DELETE SET NULL)'
	);
	await client.execute("INSERT INTO revision_groups VALUES ('group', 'plan')");
}

function options(backupId: string) {
	return {
		dataPaths: resolveDataPaths(`file:${databasePath}`, keyPath),
		databaseClient: client,
		recordStore: records,
		appVersion: '1.2.3',
		trigger: 'manual' as const,
		backupId,
		createdAt: new Date('2026-07-10T12:34:56.789Z')
	};
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-backup-'));
	databasePath = join(directory, 'posterpilot.db');
	keyPath = join(directory, '.app-key');
	client = createClient({ url: `file:${databasePath}` });
	records = new MemoryRecordStore();
	await seedDatabase();
});

afterEach(() => {
	client.close();
	rmSync(directory, { recursive: true, force: true });
});

describe('createBackupBundle', () => {
	it('creates a consistent owner-only snapshot, key, manifest, and completed record', async () => {
		const key = Buffer.alloc(32, 7);
		writeFileSync(keyPath, key, { mode: 0o600 });
		const kometaAssets = join(directory, 'kometa');
		mkdirSync(kometaAssets);

		const result = await createBackupBundle({
			...options('backup-generated'),
			keySource: { mode: 'generated', path: keyPath },
			externalPaths: [
				{ kind: 'kometa_assets', path: kometaAssets, expectedType: 'directory' },
				{ kind: 'kometa_config', path: join(directory, 'missing.yml'), expectedType: 'file' }
			]
		});

		const snapshotPath = join(result.storagePath, 'posterpilot.db');
		const snapshot = createClient({ url: `file:${snapshotPath}` });
		try {
			const rows = await snapshot.execute('SELECT title FROM library_items');
			expect(rows.rows[0]?.title).toBe('Arrival');
			for (const table of ['http_cache', 'thumbnail_cache', 'operation_plans']) {
				const ephemeral = await snapshot.execute(`SELECT count(*) AS count FROM ${table}`);
				expect(Number(ephemeral.rows[0]?.count)).toBe(0);
			}
			const references = await snapshot.execute(
				"SELECT plan_id FROM revision_groups WHERE id = 'group'"
			);
			expect(references.rows[0]?.plan_id).toBeNull();
			expect((await snapshot.execute('PRAGMA foreign_key_check')).rows).toHaveLength(0);
		} finally {
			snapshot.close();
		}
		expect(readFileSync(snapshotPath).toString('latin1')).not.toContain('backup-secret');

		const manifestText = readFileSync(join(result.storagePath, 'manifest.json'), 'utf8');
		const manifest = JSON.parse(manifestText) as BackupManifestV1;
		expect(manifest.schemaVersion).toBe('123456789');
		expect(manifest.key).toEqual({
			mode: 'generated',
			fingerprint: fingerprintEncryptionKey(key),
			included: true
		});
		expect(manifest.files.map((file) => file.path)).toEqual(['.app-key', 'posterpilot.db']);
		expect(manifest.externalPaths.map((path) => path.reachable)).toEqual([true, false]);
		expect(readFileSync(join(result.storagePath, '.app-key'))).toEqual(key);
		expect(readdirSync(result.storagePath).sort()).toEqual([
			'.app-key',
			'manifest.json',
			'posterpilot.db'
		]);
		expect(statSync(result.storagePath).mode & 0o777).toBe(0o700);
		expect(statSync(snapshotPath).mode & 0o777).toBe(0o600);
		expect(statSync(join(result.storagePath, '.app-key')).mode & 0o777).toBe(0o600);
		expect(statSync(join(result.storagePath, 'manifest.json')).mode & 0o777).toBe(0o600);
		expect(result.manifestChecksum).toBe(sha256Bytes(manifestText));
		expect(records.creating).toHaveLength(1);
		expect(records.completed).toHaveLength(1);
		expect(records.completed[0]?.checksum).toBe(result.manifestChecksum);
		expect(records.failed).toHaveLength(0);
	});

	it('records environment and none key modes without storing key material', async () => {
		const environmentKey = Buffer.alloc(32, 9);
		const environment = await createBackupBundle({
			...options('backup-environment'),
			keySource: { mode: 'environment', key: environmentKey }
		});
		const none = await createBackupBundle({
			...options('backup-none'),
			createdAt: new Date('2026-07-10T12:34:57.789Z'),
			keySource: { mode: 'none' }
		});

		expect(environment.manifest.key).toEqual({
			mode: 'environment',
			fingerprint: fingerprintEncryptionKey(environmentKey),
			included: false
		});
		expect(none.manifest.key).toEqual({ mode: 'none', fingerprint: null, included: false });
		expect(existsSync(join(environment.storagePath, '.app-key'))).toBe(false);
		expect(existsSync(join(none.storagePath, '.app-key'))).toBe(false);
		expect(JSON.stringify(environment.manifest)).not.toContain(environmentKey.toString('hex'));
	});

	it('checkpoints WAL and retries VACUUM INTO without copying the live database', async () => {
		let vacuumCalls = 0;
		let checkpointCalls = 0;
		const retryingClient = {
			execute: async (statement: InStatement) => {
				const sql = typeof statement === 'string' ? statement : statement.sql;
				if (sql === 'VACUUM INTO ?' && vacuumCalls++ === 0) {
					throw new Error('simulated busy snapshot');
				}
				if (sql === 'PRAGMA wal_checkpoint(FULL)') checkpointCalls++;
				return client.execute(statement);
			}
		} as Pick<Client, 'execute'>;

		const result = await createBackupBundle({
			...options('backup-checkpoint'),
			databaseClient: retryingClient,
			keySource: { mode: 'none' }
		});

		expect(vacuumCalls).toBe(2);
		expect(checkpointCalls).toBe(1);
		expect(result.manifest.snapshot).toEqual({
			method: 'vacuum_into',
			checkpointFallback: true
		});
	});

	it('removes an incomplete bundle and records a sanitized snapshot failure', async () => {
		const failingClient = {
			execute: async () => {
				throw new Error(`secret path ${databasePath}`);
			}
		} as unknown as Pick<Client, 'execute'>;
		const paths = resolveDataPaths(`file:${databasePath}`, keyPath);
		const existingBundle = join(paths.backupsDirectory, 'existing-backup');
		mkdirSync(existingBundle, { recursive: true });
		writeFileSync(join(existingBundle, 'keep'), 'prior backup');

		await expect(
			createBackupBundle({
				...options('backup-failed-snapshot'),
				dataPaths: paths,
				databaseClient: failingClient,
				keySource: { mode: 'none' }
			})
		).rejects.toThrow('SQLite WAL checkpoint failed');

		expect(records.failed).toHaveLength(1);
		expect(records.failed[0]?.recordExists).toBe(false);
		expect(records.failed[0]?.record.errorCode).toBe('snapshot_failed');
		expect(records.failed[0]?.record.error).toBe('Backup creation failed (snapshot_failed).');
		expect(records.failed[0]?.record.error).not.toContain(databasePath);
		expect(readdirSync(paths.backupsDirectory)).toEqual(['existing-backup']);
		expect(readFileSync(join(existingBundle, 'keep'), 'utf8')).toBe('prior backup');
	});

	it('rolls back a published bundle when completing its database record fails', async () => {
		records.failCompletion = true;
		const paths = resolveDataPaths(`file:${databasePath}`, keyPath);

		await expect(
			createBackupBundle({
				...options('backup-failed-record'),
				dataPaths: paths,
				keySource: { mode: 'none' }
			})
		).rejects.toThrow('record unavailable');

		expect(records.creating).toHaveLength(1);
		expect(records.failed).toHaveLength(1);
		expect(records.failed[0]?.recordExists).toBe(true);
		expect(records.failed[0]?.record.errorCode).toBe('record_failed');
		expect(readdirSync(paths.backupsDirectory)).toEqual([]);
	});

	it('rejects an invalid generated key and removes all temporary payloads', async () => {
		writeFileSync(keyPath, Buffer.alloc(31));
		chmodSync(keyPath, 0o600);
		const paths = resolveDataPaths(`file:${databasePath}`, keyPath);

		await expect(
			createBackupBundle({
				...options('backup-invalid-key'),
				dataPaths: paths,
				keySource: { mode: 'generated', path: keyPath }
			})
		).rejects.toThrow('generated application key must be a 32-byte file');

		expect(records.failed[0]?.recordExists).toBe(true);
		expect(records.failed[0]?.record.errorCode).toBe('key_failed');
		expect(readdirSync(paths.backupsDirectory)).toEqual([]);
	});
});

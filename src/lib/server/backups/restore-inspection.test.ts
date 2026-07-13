import { createClient, type Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDataPaths, type DataPaths } from '$lib/server/data-paths';
import type { BackupManifestExternalPath } from './manifest';
import {
	inspectExternalPaths,
	inspectRestoreDatabase,
	inspectRestoreStorage
} from './restore-inspection';

const MIB = 1024 * 1024;
const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const clients: Client[] = [];
const directories: string[] = [];

function tempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), 'posterpilot-restore-inspection-'));
	directories.push(directory);
	return directory;
}

function snapshotPath(): string {
	return join(tempDirectory(), 'snapshot.db');
}

async function createSnapshot(): Promise<{ client: Client; path: string }> {
	const path = snapshotPath();
	const client = createClient({ url: `file:${path}` });
	clients.push(client);
	await client.execute('PRAGMA foreign_keys = ON');
	await client.execute('CREATE TABLE server_instances (id text PRIMARY KEY NOT NULL)');
	await client.execute(`
		CREATE TABLE media_items (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id)
		)
	`);
	await client.execute(`
		CREATE TABLE poster_candidates (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			media_item_id integer NOT NULL REFERENCES media_items(id)
		)
	`);
	await client.execute(`
		CREATE TABLE __drizzle_migrations (
			id integer PRIMARY KEY NOT NULL,
			hash text NOT NULL,
			created_at integer NOT NULL
		)
	`);
	await client.execute({
		sql: 'INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (1, ?, 100)',
		args: ['a'.repeat(64)]
	});
	await client.execute("INSERT INTO server_instances (id) VALUES ('server-a'), ('server-b')");
	await client.execute("INSERT INTO media_items (id, server_instance_id) VALUES (10, 'server-b')");
	return { client, path };
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.close()));
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('restore database integrity inspection', () => {
	it('rejects an A-to-B item relationship even when ordinary foreign keys are valid', async () => {
		const { client, path } = await createSnapshot();
		await client.execute(
			"INSERT INTO poster_candidates (id, server_instance_id, media_item_id) VALUES (1, 'server-a', 10)"
		);
		const integrity = await client.execute('PRAGMA integrity_check(1)');
		const foreignKeys = await client.execute('PRAGMA foreign_key_check');
		expect(integrity.rows[0]?.integrity_check ?? integrity.rows[0]?.[0]).toBe('ok');
		expect(foreignKeys.rows).toHaveLength(0);
		client.close();
		clients.splice(clients.indexOf(client), 1);

		await expect(inspectRestoreDatabase(path, null)).resolves.toMatchObject({
			status: 'integrity_failed'
		});
	});

	it('rejects an orphan reported by foreign_key_check even when integrity_check is ok', async () => {
		const { client, path } = await createSnapshot();
		await client.execute('PRAGMA foreign_keys = OFF');
		await client.execute(
			"INSERT INTO poster_candidates (id, server_instance_id, media_item_id) VALUES (1, 'server-a', 999)"
		);
		const integrity = await client.execute('PRAGMA integrity_check(1)');
		const foreignKeys = await client.execute('PRAGMA foreign_key_check');
		expect(integrity.rows[0]?.integrity_check ?? integrity.rows[0]?.[0]).toBe('ok');
		expect(foreignKeys.rows.length).toBeGreaterThan(0);
		client.close();
		clients.splice(clients.indexOf(client), 1);

		await expect(inspectRestoreDatabase(path, null)).resolves.toMatchObject({
			status: 'integrity_failed'
		});
	});
});

function storageFixture(): DataPaths {
	const dataDirectory = join(tempDirectory(), 'data');
	mkdirSync(join(dataDirectory, 'backups'), { recursive: true });
	return resolveDataPaths(
		`file:${join(dataDirectory, 'posterpilot.db')}`,
		join(dataDirectory, '.app-key')
	);
}

describe('restore storage inspection', () => {
	it('rounds the conservative space estimate up to the next mebibyte', async () => {
		const paths = storageFixture();
		writeFileSync(paths.databaseFile!, 'old');

		const result = await inspectRestoreStorage(paths, 10, 5, false);

		// 10 + 5 + 3 * 2 (current database) + 1 MiB headroom = 1 MiB + 21 → 2 MiB.
		expect(result.requiredBytes).toBe(2 * MIB);
		expect(result.spaceStatus).toBe('sufficient');
		expect(result.paths).toEqual({
			database: 'writable',
			application_key: 'not_applicable',
			restore_staging: 'writable',
			backup_storage: 'writable'
		});
	});

	it('keeps an exact mebibyte multiple unrounded when no current database exists', async () => {
		const paths = storageFixture();

		const result = await inspectRestoreStorage(paths, 0, 0, true);

		expect(result.requiredBytes).toBe(MIB);
		expect(result.spaceStatus).toBe('sufficient');
		expect(result.paths.application_key).toBe('writable');
	});

	it('reports insufficient space when the estimate exceeds the real free capacity', async () => {
		const paths = storageFixture();
		const fourPebibytes = 2 ** 52;

		const result = await inspectRestoreStorage(paths, fourPebibytes, 0, false);

		expect(result.requiredBytes).toBe(fourPebibytes + MIB);
		expect(result.spaceStatus).toBe('insufficient');
	});

	it('reports unavailable space and an unwritable database without a file-backed target', async () => {
		const paths = storageFixture();

		const result = await inspectRestoreStorage({ ...paths, databaseFile: null }, 1, 1, false);

		expect(result.spaceStatus).toBe('unavailable');
		expect(result.paths.database).toBe('unwritable');
	});

	it('flags a missing backups directory as an unwritable target', async () => {
		const paths = storageFixture();
		rmSync(paths.backupsDirectory, { recursive: true, force: true });

		const result = await inspectRestoreStorage(paths, 1, 1, false);

		expect(result.paths.backup_storage).toBe('unwritable');
		expect(result.paths.restore_staging).toBe('writable');
	});
});

function externalPath(
	path: string,
	expectedType: BackupManifestExternalPath['expectedType']
): BackupManifestExternalPath {
	return { kind: 'kometa_assets', path, expectedType, reachable: true };
}

describe('external path inspection', () => {
	it('reports ready for reachable directories and files of the recorded type', async () => {
		const directory = tempDirectory();
		const file = join(directory, 'config.yml');
		writeFileSync(file, 'libraries: {}');

		const result = await inspectExternalPaths([
			externalPath(directory, 'directory'),
			{ kind: 'kometa_config', path: file, expectedType: 'file', reachable: false }
		]);

		expect(result).toEqual([
			{
				kind: 'kometa_assets',
				expectedType: 'directory',
				recordedReachable: true,
				currentStatus: 'ready'
			},
			{
				kind: 'kometa_config',
				expectedType: 'file',
				recordedReachable: false,
				currentStatus: 'ready'
			}
		]);
	});

	it('reports missing when the recorded path no longer exists', async () => {
		const result = await inspectExternalPaths([
			externalPath(join(tempDirectory(), 'gone'), 'directory')
		]);

		expect(result[0]).toMatchObject({ currentStatus: 'missing' });
	});

	it('reports wrong_type in both directions when the entry type changed', async () => {
		const directory = tempDirectory();
		const file = join(directory, 'assets');
		writeFileSync(file, 'not a directory');

		const result = await inspectExternalPaths([
			externalPath(file, 'directory'),
			externalPath(directory, 'file')
		]);

		expect(result.map((entry) => entry.currentStatus)).toEqual(['wrong_type', 'wrong_type']);
	});

	it.skipIf(runningAsRoot)('reports unwritable for a read-only directory', async () => {
		const directory = join(tempDirectory(), 'assets');
		mkdirSync(directory, { mode: 0o500 });
		try {
			const result = await inspectExternalPaths([externalPath(directory, 'directory')]);
			expect(result[0]).toMatchObject({ currentStatus: 'unwritable' });
		} finally {
			chmodSync(directory, 0o700);
		}
	});

	it.skipIf(runningAsRoot)(
		'reports unreadable before writability for a write-only directory',
		async () => {
			const directory = join(tempDirectory(), 'assets');
			mkdirSync(directory, { mode: 0o300 });
			try {
				const result = await inspectExternalPaths([externalPath(directory, 'directory')]);
				expect(result[0]).toMatchObject({ currentStatus: 'unreadable' });
			} finally {
				chmodSync(directory, 0o700);
			}
		}
	);
});

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPaths, type DataPaths } from '$lib/server/data-paths';
import { processPendingRestore, sha256File, type PendingRestoreMarkerV1 } from './pending-restore';

let directory: string;
let paths: DataPaths;

function writeMarker(marker: PendingRestoreMarkerV1): Buffer {
	const bytes = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`);
	writeFileSync(paths.restore.pendingMarker, bytes);
	return bytes;
}

function stage(name: string, content: string | Buffer): { path: string; sha256: string } {
	mkdirSync(paths.restore.stagingDirectory, { recursive: true });
	const path = join(paths.restore.stagingDirectory, name);
	writeFileSync(path, content);
	return { path: name, sha256: sha256File(path) };
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-restore-'));
	paths = resolveDataPaths(
		`file:${join(directory, 'posterpilot.db')}`,
		join(directory, '.app-key')
	);
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

describe('processPendingRestore', () => {
	it('does nothing when no marker exists', () => {
		expect(processPendingRestore(paths)).toEqual({ status: 'none' });
	});

	it('atomically installs a staged database and retains database/WAL/SHM rollback copies', () => {
		writeFileSync(paths.databaseFile!, 'old database');
		writeFileSync(`${paths.databaseFile!}-wal`, 'old wal');
		writeFileSync(`${paths.databaseFile!}-shm`, 'old shm');
		const stagedDatabase = stage('restored.db', 'new database');
		writeMarker({ version: 1, stagedDatabase });

		const result = processPendingRestore(paths);

		expect(result).toEqual({
			status: 'applied',
			rollbackMarker: paths.restore.rollbackMarker
		});
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('new database');
		expect(existsSync(`${paths.databaseFile!}-wal`)).toBe(false);
		expect(existsSync(`${paths.databaseFile!}-shm`)).toBe(false);
		expect(readFileSync(paths.restore.rollbackDatabase, 'utf8')).toBe('old database');
		expect(readFileSync(paths.restore.rollbackWal, 'utf8')).toBe('old wal');
		expect(readFileSync(paths.restore.rollbackShm, 'utf8')).toBe('old shm');
		expect(existsSync(paths.restore.rollbackMarker)).toBe(true);
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(join(paths.restore.stagingDirectory, stagedDatabase.path))).toBe(true);
	});

	it('installs an optional staged app key as the same recoverable boot operation', () => {
		const oldKey = Buffer.alloc(32, 1);
		const newKey = Buffer.alloc(32, 2);
		writeFileSync(paths.databaseFile!, 'old database');
		writeFileSync(paths.appKeyFile, oldKey, { mode: 0o600 });
		const stagedDatabase = stage('restored.db', 'new database');
		const stagedKey = stage('restored.key', newKey);
		writeMarker({ version: 1, stagedDatabase, stagedKey });

		expect(processPendingRestore(paths).status).toBe('applied');

		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('new database');
		expect(readFileSync(paths.appKeyFile)).toEqual(newKey);
		expect(readFileSync(paths.restore.rollbackDatabase, 'utf8')).toBe('old database');
		expect(readFileSync(paths.restore.rollbackKey)).toEqual(oldKey);
		expect(statSync(paths.appKeyFile).mode & 0o777).toBe(0o600);
		expect(statSync(paths.restore.rollbackKey).mode & 0o777).toBe(0o600);
	});

	it('leaves the existing key untouched when the marker has no staged key', () => {
		const oldKey = Buffer.alloc(32, 3);
		writeFileSync(paths.databaseFile!, 'old database');
		writeFileSync(paths.appKeyFile, oldKey, { mode: 0o600 });
		const stagedDatabase = stage('restored.db', 'new database');
		writeMarker({ version: 1, stagedDatabase });

		expect(processPendingRestore(paths).status).toBe('applied');
		expect(readFileSync(paths.appKeyFile)).toEqual(oldKey);
		expect(existsSync(paths.restore.rollbackKey)).toBe(false);
	});

	it('rejects a staged key that is not a 32-byte application key', () => {
		const oldKey = Buffer.alloc(32, 3);
		writeFileSync(paths.databaseFile!, 'old database');
		writeFileSync(paths.appKeyFile, oldKey, { mode: 0o600 });
		const stagedDatabase = stage('restored.db', 'new database');
		const stagedKey = stage('restored.key', Buffer.alloc(31, 4));
		writeMarker({ version: 1, stagedDatabase, stagedKey });

		const result = processPendingRestore(paths);

		expect(result.status).toBe('rejected');
		expect(result).toHaveProperty('error', 'stagedKey must contain exactly 32 bytes');
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('old database');
		expect(readFileSync(paths.appKeyFile)).toEqual(oldKey);
	});

	it('rejects a checksum mismatch without changing current state', () => {
		const oldKey = Buffer.alloc(32, 4);
		writeFileSync(paths.databaseFile!, 'old database');
		writeFileSync(paths.appKeyFile, oldKey, { mode: 0o600 });
		const stagedDatabase = stage('restored.db', 'new database');
		writeMarker({
			version: 1,
			stagedDatabase: { ...stagedDatabase, sha256: '0'.repeat(64) }
		});

		const result = processPendingRestore(paths);

		expect(result.status).toBe('rejected');
		expect(result).toHaveProperty('error', 'stagedDatabase checksum does not match');
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('old database');
		expect(readFileSync(paths.appKeyFile)).toEqual(oldKey);
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(paths.restore.failedMarker)).toBe(true);
		expect(existsSync(paths.restore.rollbackMarker)).toBe(false);
	});

	it('rejects a staged path that escapes the staging directory', () => {
		writeFileSync(paths.databaseFile!, 'old database');
		mkdirSync(paths.restore.stagingDirectory, { recursive: true });
		const outside = join(directory, 'outside.db');
		writeFileSync(outside, 'not staged');
		writeMarker({
			version: 1,
			stagedDatabase: { path: outside, sha256: sha256File(outside) }
		});

		const result = processPendingRestore(paths);

		expect(result.status).toBe('rejected');
		expect(result).toHaveProperty(
			'error',
			'stagedDatabase must stay inside the restore staging directory'
		);
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('old database');
	});

	it('rejects an app key target that collides with a SQLite sidecar', () => {
		paths = resolveDataPaths(
			`file:${join(directory, 'posterpilot.db')}`,
			join(directory, 'posterpilot.db-wal')
		);
		writeFileSync(paths.databaseFile!, 'old database');
		const stagedDatabase = stage('restored.db', 'new database');
		const stagedKey = stage('restored.key', Buffer.alloc(32, 7));
		writeMarker({ version: 1, stagedDatabase, stagedKey });

		const result = processPendingRestore(paths);

		expect(result.status).toBe('rejected');
		expect(result).toHaveProperty(
			'error',
			'application key target must differ from the database and its sidecars'
		);
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('old database');
	});

	it('recovers both database and key from a matching interrupted-restore rollback', () => {
		const oldKey = Buffer.alloc(32, 5);
		const newKey = Buffer.alloc(32, 6);
		writeFileSync(paths.databaseFile!, 'partially installed database');
		writeFileSync(`${paths.databaseFile!}-shm`, 'stale new shm');
		writeFileSync(paths.appKeyFile, newKey, { mode: 0o600 });

		const pendingBytes = writeMarker({
			version: 1,
			stagedDatabase: { path: 'restored.db', sha256: 'a'.repeat(64) },
			stagedKey: { path: 'restored.key', sha256: 'b'.repeat(64) }
		});
		mkdirSync(paths.restore.rollbackDirectory, { recursive: true });
		writeFileSync(paths.restore.rollbackDatabase, 'old database');
		writeFileSync(paths.restore.rollbackWal, 'old wal');
		writeFileSync(paths.restore.rollbackKey, oldKey, { mode: 0o600 });
		writeFileSync(
			paths.restore.rollbackMarker,
			JSON.stringify({
				version: 1,
				pendingMarkerSha256: createHash('sha256').update(pendingBytes).digest('hex'),
				databaseTarget: resolve(paths.databaseFile!),
				keyTarget: resolve(paths.appKeyFile),
				database: {
					existed: true,
					sha256: sha256File(paths.restore.rollbackDatabase),
					mode: 0o600
				},
				wal: {
					existed: true,
					sha256: sha256File(paths.restore.rollbackWal),
					mode: 0o600
				},
				shm: { existed: false },
				key: {
					existed: true,
					sha256: sha256File(paths.restore.rollbackKey),
					mode: 0o600
				}
			})
		);

		const result = processPendingRestore(paths);

		expect(result.status).toBe('rolled_back');
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('old database');
		expect(readFileSync(`${paths.databaseFile!}-wal`, 'utf8')).toBe('old wal');
		expect(existsSync(`${paths.databaseFile!}-shm`)).toBe(false);
		expect(readFileSync(paths.appKeyFile)).toEqual(oldKey);
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(paths.restore.failedMarker)).toBe(true);
		expect(existsSync(paths.restore.rollbackMarker)).toBe(true);
	});

	it('refuses to open through rollback data belonging to another marker', () => {
		writeFileSync(paths.databaseFile!, 'current database');
		writeMarker({
			version: 1,
			stagedDatabase: { path: 'restored.db', sha256: 'a'.repeat(64) }
		});
		mkdirSync(paths.restore.rollbackDirectory, { recursive: true });
		writeFileSync(
			paths.restore.rollbackMarker,
			JSON.stringify({
				version: 1,
				pendingMarkerSha256: 'f'.repeat(64),
				databaseTarget: resolve(paths.databaseFile!),
				keyTarget: null,
				database: { existed: false },
				wal: { existed: false },
				shm: { existed: false },
				key: null
			})
		);

		expect(() => processPendingRestore(paths)).toThrow(
			'could not recover an interrupted restore: existing rollback data belongs to another restore marker'
		);
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('current database');
	});
});

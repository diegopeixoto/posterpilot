import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_DATABASE_URL,
	databaseFileFromUrl,
	pathIsWithin,
	preparedRestorePath,
	resolveDataPaths,
	resolveStagedPath
} from './data-paths';

describe('databaseFileFromUrl', () => {
	it('preserves libSQL relative and absolute file paths verbatim', () => {
		expect(databaseFileFromUrl('file:./data/posterpilot.db')).toBe('./data/posterpilot.db');
		expect(databaseFileFromUrl('file:/data/posterpilot.db')).toBe('/data/posterpilot.db');
		expect(databaseFileFromUrl('file:posterpilot.db')).toBe('posterpilot.db');
	});

	it('returns null for remote and empty file URLs', () => {
		expect(databaseFileFromUrl('libsql://example.invalid/database')).toBeNull();
		expect(databaseFileFromUrl('file:')).toBeNull();
		expect(databaseFileFromUrl('file::memory:')).toBeNull();
		expect(databaseFileFromUrl('file::memory:?cache=shared')).toBeNull();
	});
});

describe('resolveDataPaths', () => {
	it('uses the development defaults when configuration is empty', () => {
		const paths = resolveDataPaths();

		expect(paths.databaseUrl).toBe(DEFAULT_DATABASE_URL);
		expect(paths.databaseFile).toBe('./data/posterpilot.db');
		expect(paths.dataDirectory).toBe('./data');
		expect(paths.appKeyFile).toBe('data/.app-key');
		expect(paths.backupsDirectory).toBe('data/backups');
		expect(paths.thumbCacheDirectory).toBe('data/thumb-cache');
	});

	it('co-locates owned state beside an absolute database file', () => {
		const paths = resolveDataPaths('file:/srv/posterpilot/state.db');

		expect(paths.dataDirectory).toBe('/srv/posterpilot');
		expect(paths.appKeyFile).toBe('/srv/posterpilot/.app-key');
		expect(paths.backupsDirectory).toBe('/srv/posterpilot/backups');
		expect(paths.restore).toEqual({
			stagingDirectory: '/srv/posterpilot/restore-staging',
			pendingMarker: '/srv/posterpilot/restore-pending.json',
			failedMarker: '/srv/posterpilot/restore-failed.json',
			rollbackDirectory: '/srv/posterpilot/restore-rollback',
			rollbackMarker: '/srv/posterpilot/restore-rollback/restore-rollback.json',
			rollbackDatabase: '/srv/posterpilot/restore-rollback/database.db',
			rollbackWal: '/srv/posterpilot/restore-rollback/database.db-wal',
			rollbackShm: '/srv/posterpilot/restore-rollback/database.db-shm',
			rollbackKey: '/srv/posterpilot/restore-rollback/.app-key'
		});
	});

	it('uses the actual current directory for a same-directory database', () => {
		const paths = resolveDataPaths('file:posterpilot.db');

		expect(paths.dataDirectory).toBe('.');
		expect(paths.appKeyFile).toBe('.app-key');
		expect(paths.restore.pendingMarker).toBe('restore-pending.json');
	});

	it('keeps an explicit app key path while falling back for a remote database', () => {
		const paths = resolveDataPaths('libsql://example.invalid/database', '/run/secrets/app-key');

		expect(paths.databaseFile).toBeNull();
		expect(paths.dataDirectory).toBe('./data');
		expect(paths.appKeyFile).toBe('/run/secrets/app-key');
	});
});

describe('restore path helpers', () => {
	it('resolves staged relative paths under the staging directory', () => {
		const staging = '/srv/posterpilot/restore-staging';
		expect(resolveStagedPath(staging, 'database.db')).toBe(
			'/srv/posterpilot/restore-staging/database.db'
		);
		expect(resolveStagedPath(staging, '/tmp/database.db')).toBe('/tmp/database.db');
	});

	it('recognizes paths confined to a directory', () => {
		const base = resolve('/tmp/posterpilot-restore');
		expect(pathIsWithin(base, base)).toBe(true);
		expect(pathIsWithin(base, resolve(base, 'nested/database.db'))).toBe(true);
		expect(pathIsWithin(base, resolve(base, '..safe/database.db'))).toBe(true);
		expect(pathIsWithin(base, resolve(base, '../database.db'))).toBe(false);
	});

	it('places the prepared replacement beside its target', () => {
		expect(preparedRestorePath('/data/posterpilot.db')).toBe('/data/posterpilot.db.restore-next');
	});
});

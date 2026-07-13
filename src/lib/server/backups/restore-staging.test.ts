import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPaths, type DataPaths } from '$lib/server/data-paths';
import {
	finalizeAppliedPendingRestore,
	processPendingRestore,
	sha256File,
	type PendingRestoreContextV1
} from '$lib/server/db/pending-restore';
import type { BackupManifestV1 } from './manifest';
import { stageApplicationRestore } from './restore-staging';

let directory: string;
let bundle: string;
let paths: DataPaths;

const restore: PendingRestoreContextV1 = {
	restoreId: 'restore-1',
	backupId: 'backup-1',
	safetyBackupId: 'safety-1',
	manifestChecksum: 'a'.repeat(64),
	previewChecksum: 'b'.repeat(64),
	createdAt: '2026-07-10T21:00:00.000Z'
};

function bundleManifest(databaseChecksum: string): BackupManifestV1 {
	return {
		format: 'posterpilot-backup',
		formatVersion: 1,
		backupId: 'backup-1',
		trigger: 'manual',
		createdAt: '2026-07-01T10:00:00.000Z',
		appVersion: '0.8.0',
		schemaVersion: '100',
		snapshot: { method: 'vacuum_into', checkpointFallback: false },
		key: { mode: 'none', fingerprint: null, included: false },
		files: [{ path: 'database.db', role: 'database', sizeBytes: 12, sha256: databaseChecksum }],
		externalPaths: []
	};
}

function keyedManifest(
	databaseChecksum: string,
	keyChecksum: string,
	keyBytes: number
): BackupManifestV1 {
	const base = bundleManifest(databaseChecksum);
	return {
		...base,
		key: { mode: 'generated', fingerprint: 'f'.repeat(64), included: true },
		files: [
			...base.files,
			{ path: 'app-key', role: 'application_key', sizeBytes: keyBytes, sha256: keyChecksum }
		]
	};
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-stage-'));
	bundle = join(directory, 'bundle');
	paths = resolveDataPaths(
		`file:${join(directory, 'data', 'posterpilot.db')}`,
		join(directory, 'data', '.app-key')
	);
	mkdirSync(bundle, { recursive: true });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('restore staging and boot commit', () => {
	it('retains rollback until readiness explicitly commits the orchestrated restore', async () => {
		const database = join(bundle, 'database.db');
		writeFileSync(database, 'new database');
		mkdirSync(join(directory, 'data'), { recursive: true });
		writeFileSync(paths.databaseFile!, 'old database');

		await stageApplicationRestore({
			dataPaths: paths,
			bundleDirectory: bundle,
			manifest: bundleManifest(sha256File(database)),
			restore
		});
		const result = processPendingRestore(paths);

		expect(result).toMatchObject({ status: 'applied', restore });
		expect(readFileSync(paths.databaseFile!, 'utf8')).toBe('new database');
		expect(existsSync(paths.restore.pendingMarker)).toBe(true);
		expect(existsSync(paths.restore.rollbackMarker)).toBe(true);

		finalizeAppliedPendingRestore(paths, restore.restoreId);
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(paths.restore.rollbackDirectory)).toBe(false);
		expect(existsSync(paths.restore.stagingDirectory)).toBe(false);
	});

	it('publishes no marker and removes staging when copied bytes fail checksum verification', async () => {
		writeFileSync(join(bundle, 'database.db'), 'tampered');
		await expect(
			stageApplicationRestore({
				dataPaths: paths,
				bundleDirectory: bundle,
				manifest: bundleManifest('f'.repeat(64)),
				restore
			})
		).rejects.toThrow('staged_restore_checksum_mismatch');
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(join(paths.restore.stagingDirectory, restore.restoreId))).toBe(false);
	});

	it('refuses to stage while another restore is already pending', async () => {
		const database = join(bundle, 'database.db');
		writeFileSync(database, 'new database');
		mkdirSync(join(directory, 'data'), { recursive: true });
		writeFileSync(paths.restore.pendingMarker, '{}');

		await expect(
			stageApplicationRestore({
				dataPaths: paths,
				bundleDirectory: bundle,
				manifest: bundleManifest(sha256File(database)),
				restore
			})
		).rejects.toThrow('restore_already_pending');
		expect(existsSync(paths.restore.stagingDirectory)).toBe(false);
	});

	it('refuses to stage while a previous restore still requires rollback recovery', async () => {
		const database = join(bundle, 'database.db');
		writeFileSync(database, 'new database');
		mkdirSync(paths.restore.rollbackDirectory, { recursive: true });
		writeFileSync(paths.restore.rollbackMarker, '{}');

		await expect(
			stageApplicationRestore({
				dataPaths: paths,
				bundleDirectory: bundle,
				manifest: bundleManifest(sha256File(database)),
				restore
			})
		).rejects.toThrow('restore_recovery_required');
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(paths.restore.stagingDirectory)).toBe(false);
	});

	it('rejects a manifest without a database payload before touching staging', async () => {
		await expect(
			stageApplicationRestore({
				dataPaths: paths,
				bundleDirectory: bundle,
				manifest: { ...bundleManifest('a'.repeat(64)), files: [] },
				restore
			})
		).rejects.toThrow('restore_database_missing');
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(paths.restore.stagingDirectory)).toBe(false);
	});

	it('rejects a staged application key that is not exactly 32 bytes and cleans up', async () => {
		const database = join(bundle, 'database.db');
		writeFileSync(database, 'new database');
		const keyFile = join(bundle, 'app-key');
		writeFileSync(keyFile, Buffer.alloc(31, 7));

		await expect(
			stageApplicationRestore({
				dataPaths: paths,
				bundleDirectory: bundle,
				manifest: keyedManifest(sha256File(database), sha256File(keyFile), 31),
				restore
			})
		).rejects.toThrow('restore_key_invalid');
		expect(existsSync(paths.restore.pendingMarker)).toBe(false);
		expect(existsSync(join(paths.restore.stagingDirectory, restore.restoreId))).toBe(false);
	});

	it('stages a 32-byte application key and records it in the pending marker', async () => {
		const database = join(bundle, 'database.db');
		writeFileSync(database, 'new database');
		const keyFile = join(bundle, 'app-key');
		writeFileSync(keyFile, Buffer.alloc(32, 7));
		const keyChecksum = sha256File(keyFile);

		await stageApplicationRestore({
			dataPaths: paths,
			bundleDirectory: bundle,
			manifest: keyedManifest(sha256File(database), keyChecksum, 32),
			restore
		});

		const stagedKey = join(paths.restore.stagingDirectory, restore.restoreId, '.app-key');
		expect(readFileSync(stagedKey)).toEqual(Buffer.alloc(32, 7));
		expect(JSON.parse(readFileSync(paths.restore.pendingMarker, 'utf8'))).toMatchObject({
			version: 1,
			stagedDatabase: { sha256: sha256File(database) },
			stagedKey: { path: stagedKey, sha256: keyChecksum },
			restore
		});
	});
});

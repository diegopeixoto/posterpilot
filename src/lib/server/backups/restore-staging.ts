import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DataPaths } from '$lib/server/data-paths';
import { sha256File, type PendingRestoreContextV1 } from '$lib/server/db/pending-restore';
import type { BackupManifestV1 } from './manifest';

export interface StageRestoreInput {
	dataPaths: DataPaths;
	bundleDirectory: string;
	manifest: BackupManifestV1;
	restore: PendingRestoreContextV1;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function copyVerified(source: string, destination: string, checksum: string): Promise<void> {
	await copyFile(source, destination);
	await chmod(destination, 0o600);
	if (sha256File(destination) !== checksum) throw new Error('staged_restore_checksum_mismatch');
}

/** Copy validated payloads and publish the boot marker as the final atomic step. */
export async function stageApplicationRestore(input: StageRestoreInput): Promise<void> {
	const { dataPaths, manifest, restore } = input;
	if (await exists(dataPaths.restore.pendingMarker)) throw new Error('restore_already_pending');
	if (await exists(dataPaths.restore.rollbackMarker)) throw new Error('restore_recovery_required');
	const database = manifest.files.find((file) => file.role === 'database');
	if (!database) throw new Error('restore_database_missing');
	const key = manifest.files.find((file) => file.role === 'application_key');
	const directory = join(dataPaths.restore.stagingDirectory, restore.restoreId);
	const temporaryMarker = `${dataPaths.restore.pendingMarker}.tmp`;

	await mkdir(dataPaths.restore.stagingDirectory, { recursive: true, mode: 0o700 });
	await mkdir(directory, { recursive: false, mode: 0o700 });
	try {
		const stagedDatabase = join(directory, 'database.db');
		await copyVerified(join(input.bundleDirectory, database.path), stagedDatabase, database.sha256);
		let stagedKey: { path: string; sha256: string } | undefined;
		if (key) {
			const target = join(directory, '.app-key');
			await copyVerified(join(input.bundleDirectory, key.path), target, key.sha256);
			if ((await readFile(target)).byteLength !== 32) throw new Error('restore_key_invalid');
			stagedKey = { path: target, sha256: key.sha256 };
		}

		const marker = {
			version: 1 as const,
			stagedDatabase: { path: stagedDatabase, sha256: database.sha256 },
			...(stagedKey ? { stagedKey } : {}),
			restore
		};
		await mkdir(dirname(dataPaths.restore.pendingMarker), { recursive: true, mode: 0o700 });
		await writeFile(temporaryMarker, `${JSON.stringify(marker, null, 2)}\n`, {
			mode: 0o600,
			flag: 'wx'
		});
		await rename(temporaryMarker, dataPaths.restore.pendingMarker);
	} catch (error) {
		await rm(temporaryMarker, { force: true });
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

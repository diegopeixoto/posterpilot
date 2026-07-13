import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_DATABASE_URL = 'file:./data/posterpilot.db';
const DEFAULT_DATA_DIRECTORY = './data';

const FILE_URL_PREFIX = 'file:';

export interface RestorePaths {
	stagingDirectory: string;
	pendingMarker: string;
	failedMarker: string;
	rollbackDirectory: string;
	rollbackMarker: string;
	rollbackDatabase: string;
	rollbackWal: string;
	rollbackShm: string;
	rollbackKey: string;
}

export interface DataPaths {
	databaseUrl: string;
	databaseFile: string | null;
	dataDirectory: string;
	appKeyFile: string;
	backupsDirectory: string;
	thumbCacheDirectory: string;
	restore: RestorePaths;
}

/**
 * Return the local path from a libSQL `file:` URL without URL-normalizing it.
 *
 * libSQL deliberately accepts relative values such as `file:./data/app.db`.
 * Passing those through the platform URL parser would incorrectly turn them
 * into root-relative paths, so the prefix is stripped directly instead.
 */
export function databaseFileFromUrl(databaseUrl: string): string | null {
	if (!databaseUrl.startsWith(FILE_URL_PREFIX)) return null;
	const file = databaseUrl.slice(FILE_URL_PREFIX.length);
	return file === '' || file === ':memory:' || file.startsWith(':memory:?') ? null : file;
}

/** True when `candidate` resolves to `base` or one of its descendants. */
export function pathIsWithin(base: string, candidate: string): boolean {
	const resolvedBase = resolve(base);
	const resolvedCandidate = resolve(candidate);
	const child = relative(resolvedBase, resolvedCandidate);
	return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

/**
 * Resolve every PosterPilot-owned data path from deployment configuration.
 * This module intentionally reads neither `$env` nor `process.env`, keeping the
 * path contract deterministic and directly unit-testable.
 */
export function resolveDataPaths(
	databaseUrl?: string | null,
	appKeyFile?: string | null
): DataPaths {
	const effectiveDatabaseUrl = databaseUrl || DEFAULT_DATABASE_URL;
	const databaseFile = databaseFileFromUrl(effectiveDatabaseUrl);
	const dataDirectory = databaseFile ? dirname(databaseFile) : DEFAULT_DATA_DIRECTORY;
	const effectiveAppKeyFile = appKeyFile || join(dataDirectory, '.app-key');
	const stagingDirectory = join(dataDirectory, 'restore-staging');
	const rollbackDirectory = join(dataDirectory, 'restore-rollback');

	return {
		databaseUrl: effectiveDatabaseUrl,
		databaseFile,
		dataDirectory,
		appKeyFile: effectiveAppKeyFile,
		backupsDirectory: join(dataDirectory, 'backups'),
		thumbCacheDirectory: join(dataDirectory, 'thumb-cache'),
		restore: {
			stagingDirectory,
			pendingMarker: join(dataDirectory, 'restore-pending.json'),
			failedMarker: join(dataDirectory, 'restore-failed.json'),
			rollbackDirectory,
			rollbackMarker: join(rollbackDirectory, 'restore-rollback.json'),
			rollbackDatabase: join(rollbackDirectory, 'database.db'),
			rollbackWal: join(rollbackDirectory, 'database.db-wal'),
			rollbackShm: join(rollbackDirectory, 'database.db-shm'),
			rollbackKey: join(rollbackDirectory, '.app-key')
		}
	};
}

/** Resolve a marker's staged-file value, relative to the staging directory. */
export function resolveStagedPath(stagingDirectory: string, stagedPath: string): string {
	return isAbsolute(stagedPath) ? resolve(stagedPath) : resolve(stagingDirectory, stagedPath);
}

/** App-owned sibling used to prepare an atomic replacement on the target filesystem. */
export function preparedRestorePath(target: string): string {
	return `${target}.restore-next`;
}

/**
 * Filesystem I/O for Kometa's `config.yml`. Kept separate from the pure merge
 * engine (`config.ts`) so the engine stays unit-testable without touching disk.
 *
 * Writes are atomic (temp file + rename) and always leave a timestamped backup,
 * so a failed or partial write can never corrupt the user's existing config.
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const BACKUP_INFIX = '.posterpilot-bak-';

/** Read the config file at `path`, or null when it does not exist. */
export function readConfig(path: string): string | null {
	if (!existsSync(path)) return null;
	return readFileSync(path, 'utf8');
}

/** Make a timestamp safe for use in a filename (no colons/dots). */
function safeStamp(stamp: string): string {
	return stamp.replace(/[:.]/g, '-');
}

/**
 * Write `text` to `path` atomically, backing up any existing file first.
 *
 * @returns the backup file path that was created (or null if there was no prior file).
 */
export function writeConfigAtomic(
	path: string,
	text: string,
	stamp: string,
	opts: { backups?: number } = {}
): { backup: string | null } {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });

	const stampSafe = safeStamp(stamp);
	let backup: string | null = null;
	if (existsSync(path)) {
		backup = join(dir, `${basename(path)}${BACKUP_INFIX}${stampSafe}`);
		copyFileSync(path, backup);
	}

	const tmp = join(dir, `.${basename(path)}.tmp-${stampSafe}`);
	writeFileSync(tmp, text, 'utf8');
	renameSync(tmp, path); // atomic on the same filesystem

	pruneBackups(dir, basename(path), opts.backups ?? 5);
	return { backup };
}

/** Keep only the newest `keep` backups for a config file; delete the rest. */
export function pruneBackups(dir: string, configName: string, keep: number): void {
	if (keep < 0) return;
	const prefix = `${configName}${BACKUP_INFIX}`;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	const backups = entries.filter((e) => e.startsWith(prefix)).sort(); // stamp sorts lexicographically
	for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
		try {
			unlinkSync(join(dir, old));
		} catch {
			// best-effort cleanup; ignore
		}
	}
}

/** A backup file PosterPilot has written for the config. */
export interface BackupInfo {
	name: string;
	stamp: string;
}

/** List backups for a config file, newest first. */
export function listBackups(path: string): BackupInfo[] {
	const dir = dirname(path);
	const prefix = `${basename(path)}${BACKUP_INFIX}`;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.startsWith(prefix))
		.map((e) => ({ name: e, stamp: e.slice(prefix.length) }))
		.sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/** Read one validated backup belonging to this config file. */
export function readBackup(path: string, name: string): string {
	const prefix = `${basename(path)}${BACKUP_INFIX}`;
	if (!name.startsWith(prefix) || name.includes('/') || name.includes('..')) {
		throw new Error('Invalid backup name');
	}
	const src = join(dirname(path), name);
	if (!existsSync(src)) throw new Error('Backup not found');
	return readFileSync(src, 'utf8');
}

/**
 * Restore a named backup over the current config, backing up the current file
 * first. The backup name is validated to belong to this config (no traversal).
 */
export function restoreBackup(
	path: string,
	name: string,
	stamp: string
): { backup: string | null } {
	const content = readBackup(path, name);
	return writeConfigAtomic(path, content, stamp);
}

// ── Single-flight lock (per absolute path) ────────────────────────────────────
// Serializes read-modify-write cycles so two concurrent syncs can't interleave on
// the same file. In-process only (the app is a single container).
const chains = new Map<string, Promise<unknown>>();

export function withConfigLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	const prev = chains.get(path) ?? Promise.resolve();
	const run = prev.then(fn, fn); // run regardless of the previous task's outcome
	chains.set(
		path,
		run.catch(() => undefined)
	);
	return run;
}

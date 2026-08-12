import type { Client } from '@libsql/client';
import { stat, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';

const INTEGRITY_ROW_LIMIT = 10;

function scalar(rows: readonly Record<string, unknown>[], key: string): unknown {
	return rows[0]?.[key] ?? null;
}

function finite(value: unknown): number | null {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

async function size(path: string): Promise<number | null> {
	try {
		return (await stat(path)).size;
	} catch {
		return null;
	}
}

/** Collect bounded SQLite/storage metadata without exposing database contents or paths. */
export async function inspectSupportDatabase(client: Pick<Client, 'execute'>, file: string | null) {
	// Keep these sequential: they share the production client, and diagnostics
	// should not manufacture contention while trying to describe it.
	const journal = await client.execute('PRAGMA journal_mode');
	const synchronous = await client.execute('PRAGMA synchronous');
	const autoCheckpoint = await client.execute('PRAGMA wal_autocheckpoint');
	const pageSize = await client.execute('PRAGMA page_size');
	const pageCount = await client.execute('PRAGMA page_count');
	const integrity = await client.execute(`PRAGMA quick_check(${INTEGRITY_ROW_LIMIT})`);
	// PASSIVE may copy committed frames but never waits for readers or truncates the WAL.
	const checkpoint = await client.execute('PRAGMA wal_checkpoint(PASSIVE)');

	let storage: Record<string, unknown> = { kind: file ? 'local_file' : 'remote_or_memory' };
	if (file) {
		let filesystem: Record<string, unknown> | null;
		try {
			const value = await statfs(dirname(file));
			filesystem = {
				type: String(value.type),
				blockSize: finite(value.bsize)
			};
		} catch {
			filesystem = null;
		}
		storage = {
			kind: 'local_file',
			filesystem,
			files: {
				databaseBytes: await size(file),
				walBytes: await size(`${file}-wal`),
				shmBytes: await size(`${file}-shm`)
			}
		};
	}
	return {
		pragmas: {
			journalMode: scalar(journal.rows, 'journal_mode'),
			synchronous: scalar(synchronous.rows, 'synchronous'),
			walAutoCheckpoint: scalar(autoCheckpoint.rows, 'wal_autocheckpoint'),
			pageSize: scalar(pageSize.rows, 'page_size'),
			pageCount: scalar(pageCount.rows, 'page_count')
		},
		quickCheck: integrity.rows.slice(0, INTEGRITY_ROW_LIMIT),
		passiveCheckpoint: checkpoint.rows,
		storage
	};
}

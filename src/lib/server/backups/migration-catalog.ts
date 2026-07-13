import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export interface SupportedMigration {
	id: string;
	createdAt: number;
	hash: string;
}

interface MigrationJournal {
	entries?: Array<{ tag?: unknown; when?: unknown }>;
}

/** Read the same ordered migration chain used by Drizzle at application boot. */
export function loadSupportedMigrations(folder = './drizzle'): SupportedMigration[] {
	const migrations = readMigrationFiles({ migrationsFolder: folder });
	const journal = JSON.parse(
		readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')
	) as MigrationJournal;
	if (!Array.isArray(journal.entries) || journal.entries.length !== migrations.length) {
		throw new Error('migration catalog and journal do not match');
	}

	return migrations.map((migration, index) => {
		const entry = journal.entries?.[index];
		if (
			!entry ||
			typeof entry.tag !== 'string' ||
			!/^[A-Za-z0-9_-]+$/.test(entry.tag) ||
			typeof entry.when !== 'number' ||
			!Number.isSafeInteger(entry.when) ||
			entry.when !== migration.folderMillis ||
			!/^[a-f0-9]{64}$/.test(migration.hash)
		) {
			throw new Error('migration catalog entry is invalid');
		}
		return { id: entry.tag, createdAt: entry.when, hash: migration.hash };
	});
}

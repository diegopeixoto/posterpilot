import { and, count, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import type { ArtworkLockKey, ArtworkLockStore } from './artwork-locks';

export type Database = LibSQLDatabase<typeof schema>;

const { artworkFieldLocks } = schema;

function slot(key: ArtworkLockKey) {
	return and(
		eq(artworkFieldLocks.serverInstanceId, key.serverInstanceId),
		eq(artworkFieldLocks.targetId, key.targetId),
		eq(artworkFieldLocks.kind, key.kind)
	);
}

export function createDatabaseArtworkLockStore(database: Database): ArtworkLockStore {
	return {
		async has(key) {
			const rows = await database
				.select({ kind: artworkFieldLocks.kind })
				.from(artworkFieldLocks)
				.where(slot(key))
				.limit(1);
			return rows.length > 0;
		},
		async add(key) {
			await database.insert(artworkFieldLocks).values(key).onConflictDoNothing();
		},
		async remove(key) {
			await database.delete(artworkFieldLocks).where(slot(key));
		},
		async countForTarget(serverInstanceId, targetId) {
			const [row] = await database
				.select({ total: count() })
				.from(artworkFieldLocks)
				.where(
					and(
						eq(artworkFieldLocks.serverInstanceId, serverInstanceId),
						eq(artworkFieldLocks.targetId, targetId)
					)
				);
			return row?.total ?? 0;
		}
	};
}

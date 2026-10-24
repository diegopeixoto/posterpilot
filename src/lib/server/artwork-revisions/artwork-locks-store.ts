import { and, count, eq, sql } from 'drizzle-orm';
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
		async holds(key) {
			const [row] = await database
				.select({ holds: artworkFieldLocks.holds })
				.from(artworkFieldLocks)
				.where(slot(key))
				.limit(1);
			return row?.holds ?? 0;
		},
		async add(key) {
			await database
				.insert(artworkFieldLocks)
				.values(key)
				.onConflictDoUpdate({
					target: [
						artworkFieldLocks.serverInstanceId,
						artworkFieldLocks.targetId,
						artworkFieldLocks.kind
					],
					set: { holds: sql`${artworkFieldLocks.holds} + 1` }
				});
		},
		async release(key) {
			await database.batch([
				database
					.delete(artworkFieldLocks)
					.where(and(slot(key), sql`${artworkFieldLocks.holds} <= 1`)),
				database
					.update(artworkFieldLocks)
					.set({ holds: sql`${artworkFieldLocks.holds} - 1` })
					.where(slot(key))
			]);
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

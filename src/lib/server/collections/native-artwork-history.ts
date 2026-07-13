import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkRevisionGroups, artworkRevisions, mediaCollections } from '$lib/server/db/schema';

type Database = LibSQLDatabase<typeof schema>;

export interface PublicNativeCollectionArtworkHistoryEntry {
	id: string;
	group: {
		id: string;
		kind: 'apply' | 'undo' | 'external_observation';
		outcome: 'pending' | 'success' | 'partial' | 'failed';
		createdAt: string;
		completedAt: string | null;
	};
	undoOfRevisionId: string | null;
	action: 'apply' | 'undo' | 'external_observation';
	kind: 'poster' | 'background';
	outcome: 'pending' | 'success' | 'failed' | 'skipped';
	verification: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	errorCode: string | null;
	hasPriorState: boolean;
	undoAvailable: boolean;
	restored: boolean;
	createdAt: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,96}$/;

function identifier(value: string): string {
	if (!SAFE_ID.test(value) || value.includes('..') || value.includes(':/')) {
		throw new TypeError('invalid_native_collection_history_scope');
	}
	return value;
}

/** Credentials-safe revision timeline for one exact native collection entity. */
export function createNativeCollectionArtworkHistory(database: Database) {
	return async function listNativeCollectionArtworkHistory(
		serverInstanceId: string,
		mediaCollectionId: string,
		limit = 50
	): Promise<PublicNativeCollectionArtworkHistoryEntry[]> {
		const serverId = identifier(serverInstanceId);
		const collectionId = identifier(mediaCollectionId);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new TypeError('invalid_native_collection_history_limit');
		}
		const [collection] = await database
			.select({ id: mediaCollections.id, source: mediaCollections.source })
			.from(mediaCollections)
			.where(
				and(
					eq(mediaCollections.id, collectionId),
					eq(mediaCollections.serverInstanceId, serverId),
					eq(mediaCollections.source, 'native'),
					isNull(mediaCollections.removedAt)
				)
			)
			.limit(1);
		if (!collection) return [];
		const rows = await database
			.select({ revision: artworkRevisions, group: artworkRevisionGroups })
			.from(artworkRevisions)
			.innerJoin(artworkRevisionGroups, eq(artworkRevisionGroups.id, artworkRevisions.groupId))
			.where(
				and(
					eq(artworkRevisions.serverInstanceId, serverId),
					isNull(artworkRevisions.mediaItemId),
					eq(artworkRevisions.mediaCollectionId, collectionId),
					eq(artworkRevisions.destination, 'server'),
					isNull(artworkRevisions.season),
					isNull(artworkRevisions.episode)
				)
			)
			.orderBy(desc(artworkRevisions.createdAt), desc(artworkRevisions.id))
			.limit(limit);
		const ids = rows.map(({ revision }) => revision.id);
		const undoRows = ids.length
			? await database
					.select({ revisionId: artworkRevisions.undoOfRevisionId })
					.from(artworkRevisions)
					.where(
						and(
							eq(artworkRevisions.serverInstanceId, serverId),
							eq(artworkRevisions.action, 'undo'),
							eq(artworkRevisions.outcome, 'success'),
							inArray(artworkRevisions.undoOfRevisionId, ids)
						)
					)
			: [];
		const restored = new Set(
			undoRows.flatMap((row) => (row.revisionId === null ? [] : [row.revisionId]))
		);
		return rows.flatMap(({ revision, group }) => {
			if (revision.kind !== 'poster' && revision.kind !== 'background') return [];
			const wasRestored = restored.has(revision.id);
			return [
				{
					id: revision.id,
					group: {
						id: group.id,
						kind: group.kind,
						outcome: group.outcome,
						createdAt: group.createdAt.toISOString(),
						completedAt: group.completedAt?.toISOString() ?? null
					},
					undoOfRevisionId: revision.undoOfRevisionId,
					action: revision.action,
					kind: revision.kind,
					outcome: revision.outcome,
					verification: revision.verification,
					errorCode:
						revision.errorCode && SAFE_CODE.test(revision.errorCode) ? revision.errorCode : null,
					hasPriorState: revision.beforeSnapshotId !== null,
					undoAvailable:
						revision.outcome === 'success' &&
						revision.beforeSnapshotId !== null &&
						revision.action !== 'external_observation' &&
						!wasRestored,
					restored: wasRestored,
					createdAt: revision.createdAt.toISOString()
				} satisfies PublicNativeCollectionArtworkHistoryEntry
			];
		});
	};
}

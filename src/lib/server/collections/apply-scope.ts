import { and, asc, eq, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { collectionMemberships, mediaCollections, mediaItems } from '$lib/server/db/schema';
import type { ApplyPlanPayloadV1 } from '$lib/server/plans/apply-plan';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { ApplyPlanValidationError } from '$lib/server/plans/apply-plan-validation';

type Database = LibSQLDatabase<typeof schema>;

export type CollectionApplyScopeErrorCode =
	| 'invalid_request'
	| 'collection_not_found'
	| 'collection_has_no_local_members';

export class CollectionApplyScopeError extends Error {
	constructor(readonly code: CollectionApplyScopeErrorCode) {
		super(code);
		this.name = 'CollectionApplyScopeError';
	}
}

export interface CollectionApplyScope {
	collectionId: string;
	serverInstanceId: string;
	itemIds: number[];
	membershipFingerprint: string;
}

function identifier(value: string): string {
	if (!value || value.trim() !== value || value.length > 255 || value.includes('\u0000')) {
		throw new CollectionApplyScopeError('invalid_request');
	}
	return value;
}

/** Freeze all active source-qualified memberships while targeting local members only. */
export async function loadCollectionApplyScope(
	database: Database,
	serverInstanceId: string,
	collectionId: string,
	options: { requireLocalMembers?: boolean } = {}
): Promise<CollectionApplyScope> {
	const serverId = identifier(serverInstanceId);
	const id = identifier(collectionId);
	const [collection] = await database
		.select({
			id: mediaCollections.id,
			serverInstanceId: mediaCollections.serverInstanceId,
			source: mediaCollections.source,
			sourceId: mediaCollections.sourceId
		})
		.from(mediaCollections)
		.where(
			and(
				eq(mediaCollections.id, id),
				eq(mediaCollections.serverInstanceId, serverId),
				isNull(mediaCollections.removedAt)
			)
		)
		.limit(1);
	if (!collection) throw new CollectionApplyScopeError('collection_not_found');

	const memberships = await database
		.select({
			id: collectionMemberships.id,
			source: collectionMemberships.source,
			sourceMemberId: collectionMemberships.sourceMemberId,
			mediaItemId: collectionMemberships.mediaItemId,
			availableLocally: collectionMemberships.availableLocally,
			itemServerInstanceId: mediaItems.serverInstanceId,
			itemSourceRemovedAt: mediaItems.sourceRemovedAt
		})
		.from(collectionMemberships)
		.leftJoin(mediaItems, eq(mediaItems.id, collectionMemberships.mediaItemId))
		.where(
			and(
				eq(collectionMemberships.collectionId, collection.id),
				eq(collectionMemberships.serverInstanceId, serverId),
				isNull(collectionMemberships.removedAt)
			)
		)
		.orderBy(
			asc(collectionMemberships.source),
			asc(collectionMemberships.sourceMemberId),
			asc(collectionMemberships.id)
		);

	const itemIds = [
		...new Set(
			memberships.flatMap((membership) =>
				membership.availableLocally &&
				membership.mediaItemId !== null &&
				membership.itemServerInstanceId === serverId &&
				membership.itemSourceRemovedAt === null
					? [membership.mediaItemId]
					: []
			)
		)
	].sort((left, right) => left - right);
	if (options.requireLocalMembers && itemIds.length === 0) {
		throw new CollectionApplyScopeError('collection_has_no_local_members');
	}

	const membershipFingerprint = hashCanonicalJson({
		version: 1,
		collection: {
			id: collection.id,
			serverInstanceId: collection.serverInstanceId,
			source: collection.source,
			sourceId: collection.sourceId
		},
		memberships: memberships.map((membership) => ({
			id: membership.id,
			source: membership.source,
			sourceMemberId: membership.sourceMemberId,
			mediaItemId: membership.mediaItemId,
			availableLocally: membership.availableLocally,
			itemAvailable:
				membership.itemServerInstanceId === serverId && membership.itemSourceRemovedAt === null
		}))
	});

	return {
		collectionId: collection.id,
		serverInstanceId: serverId,
		itemIds,
		membershipFingerprint
	};
}

/** Bind a frozen collection context to its current same-server membership. */
export async function assertCollectionApplyContextFresh(
	database: Database,
	payload: ApplyPlanPayloadV1,
	expected?: { collectionId?: string; serverInstanceId?: string }
): Promise<void> {
	if (payload.context.source !== 'collection') {
		throw new ApplyPlanValidationError(
			'plan_scope_mismatch',
			'Apply plan is not a collection plan'
		);
	}
	if (
		payload.scope.serverInstanceIds.length !== 1 ||
		(expected?.collectionId && payload.context.collectionId !== expected.collectionId) ||
		(expected?.serverInstanceId && payload.scope.serverInstanceIds[0] !== expected.serverInstanceId)
	) {
		throw new ApplyPlanValidationError(
			'plan_scope_mismatch',
			'Collection apply plan does not match the route scope'
		);
	}
	let current: CollectionApplyScope;
	try {
		current = await loadCollectionApplyScope(
			database,
			payload.scope.serverInstanceIds[0],
			payload.context.collectionId
		);
	} catch {
		throw new ApplyPlanValidationError('plan_stale', 'Collection membership is unavailable');
	}
	if (
		payload.context.membershipFingerprint !== current.membershipFingerprint ||
		JSON.stringify(payload.scope.targetItemIds) !== JSON.stringify(current.itemIds)
	) {
		throw new ApplyPlanValidationError('plan_stale', 'Collection membership changed');
	}
}

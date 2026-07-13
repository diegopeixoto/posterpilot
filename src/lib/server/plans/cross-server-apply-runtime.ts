import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mediaItems, serverInstances } from '$lib/server/db/schema';
import type { FrozenApplyJobPayload } from './apply-plan';
import { createApplyDestinationResolver } from './apply-destinations';
import { previewDatabaseArtworkApply } from './apply-runtime';
import { loadDatabaseApplyPlannerItemData } from './apply-planner-db';
import { createDatabaseApplyServerRegistry } from './apply-server-registry';
import {
	confirmCrossServerApplyPlan,
	previewCrossServerApplyPlan,
	type ConfirmCrossServerApplyRequest,
	type CrossServerApplyPreviewRequest,
	type CrossServerMatchRepository
} from './cross-server-apply';
import { operationPlanStore } from './operation-plan-store';

const identityProjection = {
	serverInstanceId: mediaItems.serverInstanceId,
	mediaItemId: mediaItems.id,
	librarySectionKey: mediaItems.sectionKey,
	sourceId: mediaItems.ratingKey,
	type: mediaItems.type,
	tmdbId: mediaItems.tmdbId,
	imdbId: mediaItems.imdbId,
	tvdbId: mediaItems.tvdbId,
	mediaType: mediaItems.mediaType,
	updatedAt: mediaItems.updatedAt,
	selectionUpdatedAt: mediaItems.selectionUpdatedAt
} as const;

function iso(value: Date | null): string | null {
	return value?.toISOString() ?? null;
}

export const databaseCrossServerMatchRepository: CrossServerMatchRepository = {
	async loadItem(ref) {
		return (await loadDatabaseApplyPlannerItemData(ref))?.item.identity ?? null;
	},

	async findExactCandidates(input) {
		const [server] = await db
			.select({
				id: serverInstances.id,
				enabled: serverInstances.enabled,
				disconnectedAt: serverInstances.disconnectedAt
			})
			.from(serverInstances)
			.where(eq(serverInstances.id, input.serverInstanceId))
			.limit(1);
		if (!server) return { serverState: 'missing', items: [] };
		if (!server.enabled || server.disconnectedAt !== null) {
			return { serverState: 'disabled', items: [] };
		}

		const identityPredicate =
			input.match.namespace === 'tmdb'
				? eq(mediaItems.tmdbId, input.match.value)
				: input.match.namespace === 'imdb'
					? eq(mediaItems.imdbId, input.match.value)
					: eq(mediaItems.tvdbId, input.match.value);
		const rows = await db
			.select(identityProjection)
			.from(mediaItems)
			.where(
				and(
					eq(mediaItems.serverInstanceId, input.serverInstanceId),
					eq(mediaItems.type, input.sourceType),
					identityPredicate,
					input.match.namespace === 'tmdb' && input.sourceMediaType !== null
						? eq(mediaItems.mediaType, input.sourceMediaType)
						: undefined,
					isNull(mediaItems.sourceRemovedAt)
				)
			);
		return {
			serverState: 'enabled',
			items: rows.map((row) => ({
				...row,
				updatedAt: iso(row.updatedAt),
				selectionUpdatedAt: iso(row.selectionUpdatedAt)
			}))
		};
	}
};

export function previewDatabaseCrossServerApply(request: CrossServerApplyPreviewRequest) {
	return previewCrossServerApplyPlan(request, {
		matchRepository: databaseCrossServerMatchRepository,
		planApply: previewDatabaseArtworkApply
	});
}

export async function confirmDatabaseCrossServerApply(
	request: ConfirmCrossServerApplyRequest,
	enqueue: (payload: FrozenApplyJobPayload) => Promise<number>
) {
	const registry = createDatabaseApplyServerRegistry();
	return confirmCrossServerApplyPlan(request, {
		matchRepository: databaseCrossServerMatchRepository,
		store: operationPlanStore,
		loadItemData: loadDatabaseApplyPlannerItemData,
		resolveDestinationSlots: createApplyDestinationResolver({ serverRegistry: registry }),
		enqueue
	});
}

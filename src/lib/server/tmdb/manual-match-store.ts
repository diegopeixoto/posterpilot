import { and, asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	childSelections,
	mediaItems,
	posterCandidates,
	resolutionAudits
} from '$lib/server/db/schema';
import {
	ManualMatchError,
	type AutomaticResolutionInput,
	type AutomaticUnresolvedInput,
	type ManualMatchItem,
	type ManualMatchRepository,
	type ResolutionSummary
} from './manual-match';
import type { TmdbManualCandidate } from './manual-search';

type Database = LibSQLDatabase<typeof schema>;
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

async function findScopedItem(
	executor: Executor,
	serverInstanceId: string,
	itemId: number
): Promise<ManualMatchItem | null> {
	const [row] = await executor
		.select({
			id: mediaItems.id,
			serverInstanceId: mediaItems.serverInstanceId,
			title: mediaItems.title,
			year: mediaItems.year,
			tmdbId: mediaItems.tmdbId,
			imdbId: mediaItems.imdbId,
			tvdbId: mediaItems.tvdbId,
			mediaType: mediaItems.mediaType,
			resolved: mediaItems.resolved,
			resolutionReason: mediaItems.resolutionReason,
			manualMatchPinned: mediaItems.manualMatchPinned,
			resolutionUpdatedAt: mediaItems.resolutionUpdatedAt
		})
		.from(mediaItems)
		.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, itemId)))
		.limit(1);
	return row ?? null;
}

function summary(item: ManualMatchItem): ResolutionSummary {
	return {
		id: item.id,
		serverInstanceId: item.serverInstanceId,
		tmdbId: item.tmdbId,
		mediaType: item.mediaType,
		resolved: item.resolved,
		resolutionReason: item.resolutionReason,
		manualMatchPinned: item.manualMatchPinned,
		resolutionUpdatedAt: item.resolutionUpdatedAt
	};
}

async function requireScopedItem(
	executor: Executor,
	serverInstanceId: string,
	itemId: number
): Promise<ManualMatchItem> {
	const item = await findScopedItem(executor, serverInstanceId, itemId);
	if (!item) throw new ManualMatchError('media_item_not_found');
	return item;
}

async function invalidateCandidates(
	executor: Executor,
	serverInstanceId: string,
	itemId: number
): Promise<void> {
	const scope = and(
		eq(posterCandidates.serverInstanceId, serverInstanceId),
		eq(posterCandidates.mediaItemId, itemId)
	);
	await executor.update(posterCandidates).set({ active: false, stale: true }).where(scope);
	await executor
		.delete(childSelections)
		.where(
			and(
				eq(childSelections.serverInstanceId, serverInstanceId),
				eq(childSelections.mediaItemId, itemId)
			)
		);
}

const invalidatedIdentityFields = {
	selectedPosterUrl: null,
	selectedBackgroundUrl: null,
	selectedPosterCandidateId: null,
	selectedBackgroundCandidateId: null,
	selectionUpdatedAt: null,
	overview: null,
	tagline: null,
	genres: null,
	runtime: null,
	rating: null,
	backdropUrl: null,
	logoUrl: null,
	seasonCount: null,
	episodeCount: null,
	cast: null,
	tmdbCollectionId: null,
	tmdbCollectionName: null,
	hasCandidates: false,
	hasMediux: false,
	discoveryStatus: 'not_started' as const,
	discoveryStartedAt: null,
	discoveryCompletedAt: null
};

/** Transactional persistence for manual/automatic resolution decisions. */
export function createManualMatchRepository(database: Database): ManualMatchRepository {
	async function getScopedItem(serverInstanceId: string, itemId: number) {
		return findScopedItem(database, serverInstanceId, itemId);
	}

	async function pin(
		serverInstanceId: string,
		itemId: number,
		candidate: TmdbManualCandidate,
		confirmedAt: Date
	): Promise<ResolutionSummary> {
		return database.transaction(async (tx) => {
			const current = await requireScopedItem(tx, serverInstanceId, itemId);
			const identityChanged =
				current.tmdbId !== candidate.tmdbId || current.mediaType !== candidate.mediaType;
			if (identityChanged) await invalidateCandidates(tx, serverInstanceId, itemId);

			await tx
				.update(mediaItems)
				.set({
					tmdbId: candidate.tmdbId,
					mediaType: candidate.mediaType,
					resolved: true,
					resolutionReason: 'manual',
					manualMatchPinned: true,
					resolutionUpdatedAt: confirmedAt,
					updatedAt: confirmedAt,
					...(identityChanged ? invalidatedIdentityFields : {})
				})
				.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, itemId)));
			await tx.insert(resolutionAudits).values({
				serverInstanceId,
				mediaItemId: itemId,
				action: current.tmdbId && identityChanged ? 'replaced' : 'pinned',
				previousTmdbId: current.tmdbId,
				previousMediaType: current.mediaType,
				resultingTmdbId: candidate.tmdbId,
				resultingMediaType: candidate.mediaType,
				reason: 'manual',
				source: 'manual_search',
				userConfirmed: true,
				details: {
					title: candidate.title,
					originalTitle: candidate.originalTitle,
					year: candidate.year
				},
				createdAt: confirmedAt
			});
			return summary(await requireScopedItem(tx, serverInstanceId, itemId));
		});
	}

	async function clear(
		serverInstanceId: string,
		itemId: number,
		clearedAt: Date
	): Promise<ResolutionSummary> {
		return database.transaction(async (tx) => {
			const current = await requireScopedItem(tx, serverInstanceId, itemId);
			if (!current.manualMatchPinned) throw new ManualMatchError('manual_pin_not_found');
			await invalidateCandidates(tx, serverInstanceId, itemId);
			await tx
				.update(mediaItems)
				.set({
					...invalidatedIdentityFields,
					tmdbId: null,
					mediaType: null,
					resolved: false,
					resolutionReason: 'manual_cleared',
					manualMatchPinned: false,
					resolutionUpdatedAt: clearedAt,
					updatedAt: clearedAt
				})
				.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, itemId)));
			await tx.insert(resolutionAudits).values({
				serverInstanceId,
				mediaItemId: itemId,
				action: 'cleared',
				previousTmdbId: current.tmdbId,
				previousMediaType: current.mediaType,
				resultingTmdbId: null,
				resultingMediaType: null,
				reason: 'manual_cleared',
				source: 'user',
				userConfirmed: true,
				createdAt: clearedAt
			});
			return summary(await requireScopedItem(tx, serverInstanceId, itemId));
		});
	}

	async function applyAutomaticResolution(
		serverInstanceId: string,
		itemId: number,
		input: AutomaticResolutionInput
	): Promise<ResolutionSummary> {
		return database.transaction(async (tx) => {
			const current = await requireScopedItem(tx, serverInstanceId, itemId);
			if (current.manualMatchPinned) return summary(current);
			const identityChanged =
				current.tmdbId !== input.resolution.tmdbId ||
				current.mediaType !== input.resolution.mediaType;
			if (identityChanged) await invalidateCandidates(tx, serverInstanceId, itemId);
			await tx
				.update(mediaItems)
				.set({
					tmdbId: input.resolution.tmdbId,
					mediaType: input.resolution.mediaType,
					resolved: true,
					resolutionReason: input.reason,
					manualMatchPinned: false,
					resolutionUpdatedAt: input.resolvedAt,
					updatedAt: input.resolvedAt,
					...(identityChanged ? invalidatedIdentityFields : {})
				})
				.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, itemId)));
			await tx.insert(resolutionAudits).values({
				serverInstanceId,
				mediaItemId: itemId,
				action: current.tmdbId ? 'refreshed' : 'created',
				previousTmdbId: current.tmdbId,
				previousMediaType: current.mediaType,
				resultingTmdbId: input.resolution.tmdbId,
				resultingMediaType: input.resolution.mediaType,
				reason: input.reason,
				source: input.source,
				userConfirmed: false,
				attemptedSources: input.attemptedSources,
				createdAt: input.resolvedAt
			});
			return summary(await requireScopedItem(tx, serverInstanceId, itemId));
		});
	}

	async function applyAutomaticUnresolved(
		serverInstanceId: string,
		itemId: number,
		input: AutomaticUnresolvedInput
	): Promise<ResolutionSummary> {
		return database.transaction(async (tx) => {
			const current = await requireScopedItem(tx, serverInstanceId, itemId);
			if (current.manualMatchPinned) return summary(current);
			await invalidateCandidates(tx, serverInstanceId, itemId);
			await tx
				.update(mediaItems)
				.set({
					...invalidatedIdentityFields,
					tmdbId: null,
					mediaType: null,
					resolved: false,
					resolutionReason: input.reason,
					manualMatchPinned: false,
					resolutionUpdatedAt: input.resolvedAt,
					updatedAt: input.resolvedAt
				})
				.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, itemId)));
			await tx.insert(resolutionAudits).values({
				serverInstanceId,
				mediaItemId: itemId,
				action: 'unresolved',
				previousTmdbId: current.tmdbId,
				previousMediaType: current.mediaType,
				resultingTmdbId: null,
				resultingMediaType: null,
				reason: input.reason,
				source: input.source,
				userConfirmed: false,
				attemptedSources: input.attemptedSources,
				createdAt: input.resolvedAt
			});
			return summary(await requireScopedItem(tx, serverInstanceId, itemId));
		});
	}

	async function listAudits(serverInstanceId: string, itemId: number) {
		return database
			.select({
				id: resolutionAudits.id,
				action: resolutionAudits.action,
				previousTmdbId: resolutionAudits.previousTmdbId,
				previousMediaType: resolutionAudits.previousMediaType,
				resultingTmdbId: resolutionAudits.resultingTmdbId,
				resultingMediaType: resolutionAudits.resultingMediaType,
				reason: resolutionAudits.reason,
				source: resolutionAudits.source,
				userConfirmed: resolutionAudits.userConfirmed,
				attemptedSources: resolutionAudits.attemptedSources,
				createdAt: resolutionAudits.createdAt
			})
			.from(resolutionAudits)
			.where(
				and(
					eq(resolutionAudits.serverInstanceId, serverInstanceId),
					eq(resolutionAudits.mediaItemId, itemId)
				)
			)
			.orderBy(asc(resolutionAudits.createdAt), asc(resolutionAudits.id));
	}

	return {
		getScopedItem,
		pin,
		clear,
		applyAutomaticResolution,
		applyAutomaticUnresolved,
		listAudits
	};
}

export type ManualMatchRepositoryStore = ReturnType<typeof createManualMatchRepository>;

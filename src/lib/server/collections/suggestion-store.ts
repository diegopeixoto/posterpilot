import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	collectionMemberships,
	mediaCollections,
	mediaItems,
	posterCandidates
} from '$lib/server/db/schema';
import type { ScoreWeights } from '$lib/server/posters/score';
import { createCollectionQueries } from './queries';
import {
	buildCollectionSuggestions,
	rankIndividualCollectionCandidates,
	type CollectionFamilySuggestion,
	type CollectionSuggestionCandidate,
	type CollectionSuggestionCandidateInput,
	type CollectionSuggestionKind
} from './suggestions';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

export interface CollectionSuggestionRanking {
	weights: ScoreWeights;
	providerPriority: readonly string[];
}

export interface PublicCollectionCandidate {
	candidateId: number;
	mediaItemId: number;
	provider: string;
	setId: string;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	kind: CollectionSuggestionKind;
	score: number;
	stale: boolean;
}

export interface PublicCollectionFamilySuggestion extends Omit<
	CollectionFamilySuggestion,
	'selections' | 'averageScore'
> {
	averageScore: number;
	selections: PublicCollectionCandidate[];
}

export interface PublicCollectionMemberCandidates {
	mediaItemId: number;
	poster: PublicCollectionCandidate[];
	background: PublicCollectionCandidate[];
}

export interface CollectionSuggestionWorkspace {
	families: PublicCollectionFamilySuggestion[];
	members: PublicCollectionMemberCandidates[];
	hasCandidates: boolean;
}

export type CollectionSuggestionStoreErrorCode =
	| 'invalid_collection_suggestion_request'
	| 'collection_not_found'
	| 'collection_suggestion_stale'
	| 'collection_member_scope_mismatch'
	| 'collection_candidate_scope_mismatch';

export class CollectionSuggestionStoreError extends Error {
	constructor(readonly code: CollectionSuggestionStoreErrorCode) {
		super(code);
		this.name = 'CollectionSuggestionStoreError';
	}
}

function identifier(value: string): string {
	if (!value || value.trim() !== value || value.includes('\u0000')) {
		throw new CollectionSuggestionStoreError('invalid_collection_suggestion_request');
	}
	return value;
}

function positiveInteger(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new CollectionSuggestionStoreError('invalid_collection_suggestion_request');
	}
	return value;
}

function suggestionKind(value: string): CollectionSuggestionKind {
	if (value !== 'poster' && value !== 'background') {
		throw new CollectionSuggestionStoreError('invalid_collection_suggestion_request');
	}
	return value;
}

function publicCandidate(candidate: CollectionSuggestionCandidate): PublicCollectionCandidate {
	return {
		candidateId: candidate.candidateId,
		mediaItemId: candidate.mediaItemId,
		provider: candidate.provider,
		setId: candidate.setId,
		setAuthor: candidate.setAuthor,
		designFamily: candidate.designFamily,
		language: candidate.language,
		kind: candidate.kind,
		score: Math.round(candidate.score * 1000) / 1000,
		stale: candidate.stale
	};
}

function publicFamily(family: CollectionFamilySuggestion): PublicCollectionFamilySuggestion {
	return {
		...family,
		averageScore: Math.round(family.averageScore * 1000) / 1000,
		selections: family.selections.map(publicCandidate)
	};
}

export function createCollectionSuggestionStore(
	database: Database,
	getRanking: () => Promise<CollectionSuggestionRanking>
) {
	const collectionQueries = createCollectionQueries(database);

	async function loadCandidateRows(
		serverInstanceId: string,
		mediaItemIds: number[]
	): Promise<CollectionSuggestionCandidateInput[]> {
		if (!mediaItemIds.length) return [];
		return database
			.select({
				id: posterCandidates.id,
				mediaItemId: posterCandidates.mediaItemId,
				provider: posterCandidates.provider,
				setId: posterCandidates.setId,
				setAuthor: posterCandidates.setAuthor,
				designFamily: posterCandidates.designFamily,
				language: posterCandidates.language,
				url: posterCandidates.url,
				kind: posterCandidates.kind,
				season: posterCandidates.season,
				episode: posterCandidates.episode,
				width: posterCandidates.width,
				height: posterCandidates.height,
				stale: posterCandidates.stale
			})
			.from(posterCandidates)
			.where(
				and(
					eq(posterCandidates.serverInstanceId, serverInstanceId),
					inArray(posterCandidates.mediaItemId, mediaItemIds),
					eq(posterCandidates.active, true),
					inArray(posterCandidates.kind, ['poster', 'background']),
					isNull(posterCandidates.season),
					isNull(posterCandidates.episode)
				)
			);
	}

	async function loadInternalWorkspace(serverInstanceId: string, collectionId: string) {
		const serverId = identifier(serverInstanceId);
		const id = identifier(collectionId);
		const collection = await collectionQueries.getCollection(serverId, id);
		if (!collection) return null;
		const memberIds = collection.localMembers.map((member) => member.id);
		const [candidates, ranking] = await Promise.all([
			loadCandidateRows(serverId, memberIds),
			getRanking()
		]);
		const rankedCandidates = rankIndividualCollectionCandidates(
			candidates,
			ranking.weights,
			ranking.providerPriority
		);
		return {
			collection,
			candidates,
			rankedCandidates,
			families: buildCollectionSuggestions({
				memberIds,
				candidates,
				weights: ranking.weights,
				providerPriority: ranking.providerPriority
			})
		};
	}

	async function getWorkspace(
		serverInstanceId: string,
		collectionId: string
	): Promise<CollectionSuggestionWorkspace | null> {
		const workspace = await loadInternalWorkspace(serverInstanceId, collectionId);
		if (!workspace) return null;
		const byMember = new Map<number, PublicCollectionMemberCandidates>();
		for (const member of workspace.collection.localMembers) {
			byMember.set(member.id, { mediaItemId: member.id, poster: [], background: [] });
		}
		for (const candidate of workspace.rankedCandidates) {
			const member = byMember.get(candidate.mediaItemId);
			if (!member) continue;
			// Keep the collection page bounded while the item detail remains the full
			// candidate browser. Every shown option is independently stageable.
			if (member[candidate.kind].length < 8) {
				member[candidate.kind].push(publicCandidate(candidate));
			}
		}
		return {
			families: workspace.families.map(publicFamily),
			members: [...byMember.values()],
			hasCandidates: workspace.rankedCandidates.length > 0
		};
	}

	async function scopedCandidate(
		executor: ReadExecutor,
		serverInstanceId: string,
		collectionId: string,
		candidateId: number
	) {
		const [row] = await executor
			.select({
				id: posterCandidates.id,
				mediaItemId: posterCandidates.mediaItemId,
				url: posterCandidates.url,
				kind: posterCandidates.kind
			})
			.from(posterCandidates)
			.innerJoin(
				collectionMemberships,
				and(
					eq(collectionMemberships.mediaItemId, posterCandidates.mediaItemId),
					eq(collectionMemberships.collectionId, collectionId),
					eq(collectionMemberships.serverInstanceId, serverInstanceId),
					eq(collectionMemberships.availableLocally, true),
					isNull(collectionMemberships.removedAt)
				)
			)
			.innerJoin(
				mediaCollections,
				and(
					eq(mediaCollections.id, collectionId),
					eq(mediaCollections.serverInstanceId, serverInstanceId),
					isNull(mediaCollections.removedAt)
				)
			)
			.innerJoin(
				mediaItems,
				and(
					eq(mediaItems.id, posterCandidates.mediaItemId),
					eq(mediaItems.serverInstanceId, serverInstanceId),
					isNull(mediaItems.sourceRemovedAt)
				)
			)
			.where(
				and(
					eq(posterCandidates.id, candidateId),
					eq(posterCandidates.serverInstanceId, serverInstanceId),
					eq(posterCandidates.active, true),
					inArray(posterCandidates.kind, ['poster', 'background']),
					isNull(posterCandidates.season),
					isNull(posterCandidates.episode)
				)
			)
			.limit(1);
		return row ?? null;
	}

	async function stageFamily(serverInstanceId: string, collectionId: string, suggestionId: string) {
		const serverId = identifier(serverInstanceId);
		const id = identifier(collectionId);
		identifier(suggestionId);
		const workspace = await loadInternalWorkspace(serverId, id);
		if (!workspace) throw new CollectionSuggestionStoreError('collection_not_found');
		const suggestion = workspace.families.find((family) => family.id === suggestionId);
		if (!suggestion) {
			throw new CollectionSuggestionStoreError('collection_suggestion_stale');
		}

		return database.transaction(async (tx) => {
			const candidateIds = suggestion.selections.map((selection) => selection.candidateId);
			const verified = await tx
				.select({
					id: posterCandidates.id,
					mediaItemId: posterCandidates.mediaItemId,
					url: posterCandidates.url,
					kind: posterCandidates.kind
				})
				.from(posterCandidates)
				.innerJoin(
					collectionMemberships,
					and(
						eq(collectionMemberships.mediaItemId, posterCandidates.mediaItemId),
						eq(collectionMemberships.collectionId, id),
						eq(collectionMemberships.serverInstanceId, serverId),
						eq(collectionMemberships.availableLocally, true),
						isNull(collectionMemberships.removedAt)
					)
				)
				.innerJoin(
					mediaCollections,
					and(
						eq(mediaCollections.id, id),
						eq(mediaCollections.serverInstanceId, serverId),
						isNull(mediaCollections.removedAt)
					)
				)
				.innerJoin(
					mediaItems,
					and(
						eq(mediaItems.id, posterCandidates.mediaItemId),
						eq(mediaItems.serverInstanceId, serverId),
						isNull(mediaItems.sourceRemovedAt)
					)
				)
				.where(
					and(
						inArray(posterCandidates.id, candidateIds),
						eq(posterCandidates.serverInstanceId, serverId),
						eq(posterCandidates.active, true),
						isNull(posterCandidates.season),
						isNull(posterCandidates.episode)
					)
				);
			const verifiedById = new Map(verified.map((candidate) => [candidate.id, candidate]));
			for (const selection of suggestion.selections) {
				const candidate = verifiedById.get(selection.candidateId);
				if (
					!candidate ||
					candidate.mediaItemId !== selection.mediaItemId ||
					candidate.kind !== selection.kind ||
					candidate.url !== selection.url
				) {
					throw new CollectionSuggestionStoreError('collection_suggestion_stale');
				}
			}

			const byMember = new Map<number, CollectionSuggestionCandidate[]>();
			for (const selection of suggestion.selections) {
				const memberSelections = byMember.get(selection.mediaItemId) ?? [];
				memberSelections.push(selection);
				byMember.set(selection.mediaItemId, memberSelections);
			}
			const changedAt = new Date();
			for (const [mediaItemId, selections] of byMember) {
				const patch: Partial<typeof mediaItems.$inferInsert> = {
					selectionUpdatedAt: changedAt,
					updatedAt: changedAt
				};
				for (const selection of selections) {
					if (selection.kind === 'poster') {
						patch.selectedPosterUrl = selection.url;
						patch.selectedPosterCandidateId = selection.candidateId;
					} else {
						patch.selectedBackgroundUrl = selection.url;
						patch.selectedBackgroundCandidateId = selection.candidateId;
					}
				}
				await tx
					.update(mediaItems)
					.set(patch)
					.where(and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverId)));
			}
			return {
				stagedSlots: suggestion.selections.length,
				coveredMembers: suggestion.coveredMemberIds.length,
				mediaItemIds: [...byMember.keys()].sort((left, right) => left - right)
			};
		});
	}

	async function assertLocalMember(
		executor: ReadExecutor,
		serverInstanceId: string,
		collectionId: string,
		mediaItemId: number
	): Promise<void> {
		const [member] = await executor
			.select({ id: mediaItems.id })
			.from(mediaItems)
			.innerJoin(
				collectionMemberships,
				and(
					eq(collectionMemberships.mediaItemId, mediaItems.id),
					eq(collectionMemberships.collectionId, collectionId),
					eq(collectionMemberships.serverInstanceId, serverInstanceId),
					eq(collectionMemberships.availableLocally, true),
					isNull(collectionMemberships.removedAt)
				)
			)
			.innerJoin(
				mediaCollections,
				and(
					eq(mediaCollections.id, collectionId),
					eq(mediaCollections.serverInstanceId, serverInstanceId),
					isNull(mediaCollections.removedAt)
				)
			)
			.where(
				and(
					eq(mediaItems.id, mediaItemId),
					eq(mediaItems.serverInstanceId, serverInstanceId),
					isNull(mediaItems.sourceRemovedAt)
				)
			)
			.limit(1);
		if (!member) {
			throw new CollectionSuggestionStoreError('collection_member_scope_mismatch');
		}
	}

	async function stageMemberCandidate(input: {
		serverInstanceId: string;
		collectionId: string;
		mediaItemId: number;
		candidateId: number;
		kind: string;
	}) {
		const serverId = identifier(input.serverInstanceId);
		const collectionId = identifier(input.collectionId);
		const mediaItemId = positiveInteger(input.mediaItemId);
		const candidateId = positiveInteger(input.candidateId);
		const kind = suggestionKind(input.kind);
		return database.transaction(async (tx) => {
			const candidate = await scopedCandidate(tx, serverId, collectionId, candidateId);
			if (!candidate || candidate.mediaItemId !== mediaItemId || candidate.kind !== kind) {
				throw new CollectionSuggestionStoreError('collection_candidate_scope_mismatch');
			}
			const changedAt = new Date();
			await tx
				.update(mediaItems)
				.set(
					kind === 'poster'
						? {
								selectedPosterUrl: candidate.url,
								selectedPosterCandidateId: candidate.id,
								selectionUpdatedAt: changedAt,
								updatedAt: changedAt
							}
						: {
								selectedBackgroundUrl: candidate.url,
								selectedBackgroundCandidateId: candidate.id,
								selectionUpdatedAt: changedAt,
								updatedAt: changedAt
							}
				)
				.where(and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverId)));
			return { mediaItemId, candidateId, kind };
		});
	}

	async function clearMemberSelection(input: {
		serverInstanceId: string;
		collectionId: string;
		mediaItemId: number;
		kind: string;
	}) {
		const serverId = identifier(input.serverInstanceId);
		const collectionId = identifier(input.collectionId);
		const mediaItemId = positiveInteger(input.mediaItemId);
		const kind = suggestionKind(input.kind);
		return database.transaction(async (tx) => {
			await assertLocalMember(tx, serverId, collectionId, mediaItemId);
			const changedAt = new Date();
			await tx
				.update(mediaItems)
				.set(
					kind === 'poster'
						? {
								selectedPosterUrl: null,
								selectedPosterCandidateId: null,
								selectionUpdatedAt: changedAt,
								updatedAt: changedAt
							}
						: {
								selectedBackgroundUrl: null,
								selectedBackgroundCandidateId: null,
								selectionUpdatedAt: changedAt,
								updatedAt: changedAt
							}
				)
				.where(and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverId)));
			return { mediaItemId, kind };
		});
	}

	async function getCandidatePreviewSource(
		serverInstanceId: string,
		collectionId: string,
		candidateId: number
	): Promise<string | null> {
		const candidate = await scopedCandidate(
			database,
			identifier(serverInstanceId),
			identifier(collectionId),
			positiveInteger(candidateId)
		);
		return candidate?.url ?? null;
	}

	return {
		getWorkspace,
		stageFamily,
		stageMemberCandidate,
		clearMemberSelection,
		getCandidatePreviewSource
	};
}

export type CollectionSuggestionStore = ReturnType<typeof createCollectionSuggestionStore>;

let liveStore: CollectionSuggestionStore | null = null;

async function runtimeStore(): Promise<CollectionSuggestionStore> {
	if (!liveStore) {
		const [{ db }, { getArtworkRankingSettings }] = await Promise.all([
			import('$lib/server/db'),
			import('$lib/server/posters/score-weights')
		]);
		liveStore = createCollectionSuggestionStore(db, async () => {
			const ranking = await getArtworkRankingSettings();
			return { weights: ranking.weights, providerPriority: ranking.providerPriority };
		});
	}
	return liveStore;
}

export const getCollectionSuggestionWorkspace = async (
	serverInstanceId: string,
	collectionId: string
) => (await runtimeStore()).getWorkspace(serverInstanceId, collectionId);
export const stageCollectionFamily = async (
	serverInstanceId: string,
	collectionId: string,
	suggestionId: string
) => (await runtimeStore()).stageFamily(serverInstanceId, collectionId, suggestionId);
export const stageCollectionMemberCandidate = async (input: {
	serverInstanceId: string;
	collectionId: string;
	mediaItemId: number;
	candidateId: number;
	kind: string;
}) => (await runtimeStore()).stageMemberCandidate(input);
export const clearCollectionMemberSelection = async (input: {
	serverInstanceId: string;
	collectionId: string;
	mediaItemId: number;
	kind: string;
}) => (await runtimeStore()).clearMemberSelection(input);
export const getCollectionCandidatePreviewSource = async (
	serverInstanceId: string,
	collectionId: string,
	candidateId: number
) => (await runtimeStore()).getCandidatePreviewSource(serverInstanceId, collectionId, candidateId);

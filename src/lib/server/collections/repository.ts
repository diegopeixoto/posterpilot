import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	collectionMemberships,
	mediaCollections,
	mediaItems,
	serverInstances
} from '$lib/server/db/schema';
import type { ServerNativeCollection, ServerType } from '$lib/server/media-server/types';
import type { TmdbCollectionRef } from '$lib/server/types';
import { sanitizeNativeCollectionArtworkUrl } from './native-artwork-url';

type Database = LibSQLDatabase<typeof schema>;
type CollectionSource = 'tmdb' | 'native';

export type CollectionMembershipProvenance = 'none' | 'tmdb' | 'native' | 'both';

export interface CollectionReconciliationResult {
	collectionsUpserted: number;
	collectionsRemoved: number;
	membershipsUpserted: number;
	membershipsRemoved: number;
}

export interface ReconcileTmdbItemCollectionInput {
	serverInstanceId: string;
	mediaItemId: number;
	collection: TmdbCollectionRef | null;
	observedAt?: Date;
}

export interface ReconcileNativeCollectionsInput {
	serverInstanceId: string;
	provider: ServerType;
	collections: ServerNativeCollection[];
	observedAt?: Date;
}

export interface ReconcileUnavailableItemsInput {
	serverInstanceId: string;
	mediaItemIds: number[];
	observedAt?: Date;
}

export interface CollectionRepositoryOptions {
	clock?: () => Date;
	generateId?: () => string;
}

export type CollectionRepositoryErrorCode =
	| 'invalid_collection_observation'
	| 'collection_server_scope_mismatch'
	| 'collection_item_scope_mismatch';

class CollectionRepositoryError extends Error {
	constructor(readonly code: CollectionRepositoryErrorCode) {
		super(code);
		this.name = 'CollectionRepositoryError';
	}
}

function checkedDate(value: Date): Date {
	const date = new Date(value.getTime());
	if (!Number.isFinite(date.getTime())) {
		throw new CollectionRepositoryError('invalid_collection_observation');
	}
	return date;
}

function identifier(value: string): string {
	if (!value || value.trim() !== value || value.includes('\u0000')) {
		throw new CollectionRepositoryError('invalid_collection_observation');
	}
	return value;
}

function displayName(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new CollectionRepositoryError('invalid_collection_observation');
	return normalized;
}

function sourceMemberKey(tmdbId: string, mediaItemId: number): string {
	// The source identity remains explicit in provenance while the local suffix
	// preserves two legitimate copies of the same TMDB title on one server.
	return `${identifier(tmdbId)}:local:${mediaItemId}`;
}

function zeroResult(): CollectionReconciliationResult {
	return {
		collectionsUpserted: 0,
		collectionsRemoved: 0,
		membershipsUpserted: 0,
		membershipsRemoved: 0
	};
}

function chunks<T>(values: T[], size = 400): T[][] {
	const result: T[][] = [];
	for (let offset = 0; offset < values.length; offset += size) {
		result.push(values.slice(offset, offset + size));
	}
	return result;
}

/** Derive the source label without ever correlating collections by display name. */
export function summarizeCollectionMembershipSources(
	sources: Iterable<CollectionSource>
): CollectionMembershipProvenance {
	const values = new Set(sources);
	return values.has('tmdb') && values.has('native')
		? 'both'
		: values.has('tmdb')
			? 'tmdb'
			: values.has('native')
				? 'native'
				: 'none';
}

/**
 * Validate and merge duplicate observations of the same native source id. This
 * deliberately never compares names: equal names with different ids stay apart.
 */
export function normalizeNativeCollectionSnapshot(
	collections: ServerNativeCollection[]
): ServerNativeCollection[] {
	const normalized = new Map<string, ServerNativeCollection>();
	for (const collection of collections) {
		const id = identifier(collection.id);
		const name = displayName(collection.name);
		const members = new Map<string, ServerNativeCollection['members'][number]>();
		for (const member of collection.members) {
			const memberId = identifier(member.id);
			members.set(memberId, {
				id: memberId,
				title: member.title?.trim() || null,
				year: Number.isSafeInteger(member.year) ? member.year : null
			});
		}
		const prior = normalized.get(id);
		if (prior) {
			for (const member of prior.members) {
				if (!members.has(member.id)) members.set(member.id, member);
			}
		}
		normalized.set(id, {
			id,
			name,
			members: [...members.values()].sort((left, right) => left.id.localeCompare(right.id)),
			currentPosterUrl: collection.currentPosterUrl ?? prior?.currentPosterUrl ?? null,
			currentBackgroundUrl: collection.currentBackgroundUrl ?? prior?.currentBackgroundUrl ?? null,
			libraryKeys: [...new Set([...(prior?.libraryKeys ?? []), ...collection.libraryKeys])]
				.map(identifier)
				.sort(),
			capabilities: collection.capabilities
		});
	}
	return [...normalized.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Server-scoped, soft-removing collection persistence. This module reads no `$env`. */
export function createCollectionRepository(
	database: Database,
	options: CollectionRepositoryOptions = {}
) {
	const clock = options.clock ?? (() => new Date());
	const generateId = options.generateId ?? randomUUID;

	async function assertServer(serverInstanceId: string): Promise<void> {
		identifier(serverInstanceId);
		const [server] = await database
			.select({ id: serverInstances.id })
			.from(serverInstances)
			.where(eq(serverInstances.id, serverInstanceId))
			.limit(1);
		if (!server) throw new CollectionRepositoryError('collection_server_scope_mismatch');
	}

	async function getItemMembershipProvenance(
		serverInstanceId: string,
		mediaItemId: number
	): Promise<CollectionMembershipProvenance> {
		const rows = await database
			.select({ source: collectionMemberships.source })
			.from(collectionMemberships)
			.where(
				and(
					eq(collectionMemberships.serverInstanceId, serverInstanceId),
					eq(collectionMemberships.mediaItemId, mediaItemId),
					isNull(collectionMemberships.removedAt)
				)
			);
		return summarizeCollectionMembershipSources(rows.map((row) => row.source));
	}

	async function reconcileTmdbItemCollection(
		input: ReconcileTmdbItemCollectionInput
	): Promise<CollectionReconciliationResult> {
		const observedAt = checkedDate(input.observedAt ?? clock());
		identifier(input.serverInstanceId);
		if (!Number.isSafeInteger(input.mediaItemId) || input.mediaItemId <= 0) {
			throw new CollectionRepositoryError('invalid_collection_observation');
		}
		const collection = input.collection
			? { id: identifier(input.collection.id), name: displayName(input.collection.name) }
			: null;

		return database.transaction(async (tx) => {
			const [item] = await tx
				.select({
					id: mediaItems.id,
					tmdbId: mediaItems.tmdbId,
					title: mediaItems.title,
					year: mediaItems.year
				})
				.from(mediaItems)
				.where(
					and(
						eq(mediaItems.id, input.mediaItemId),
						eq(mediaItems.serverInstanceId, input.serverInstanceId)
					)
				)
				.limit(1);
			if (!item) throw new CollectionRepositoryError('collection_item_scope_mismatch');
			if (collection && !item.tmdbId) {
				throw new CollectionRepositoryError('invalid_collection_observation');
			}

			const result = zeroResult();
			const previous = await tx
				.select({ id: collectionMemberships.id, collectionId: collectionMemberships.collectionId })
				.from(collectionMemberships)
				.where(
					and(
						eq(collectionMemberships.serverInstanceId, input.serverInstanceId),
						eq(collectionMemberships.mediaItemId, item.id),
						eq(collectionMemberships.source, 'tmdb'),
						isNull(collectionMemberships.removedAt)
					)
				);

			let activeMembershipId: number | null = null;
			if (collection) {
				let activeCollectionId: string;
				const [existingCollection] = await tx
					.select()
					.from(mediaCollections)
					.where(
						and(
							eq(mediaCollections.serverInstanceId, input.serverInstanceId),
							eq(mediaCollections.source, 'tmdb'),
							eq(mediaCollections.sourceId, collection.id)
						)
					)
					.limit(1);
				if (existingCollection) {
					await tx
						.update(mediaCollections)
						.set({
							name: collection.name,
							lastSyncedAt: observedAt,
							removedAt: null,
							updatedAt: observedAt
						})
						.where(eq(mediaCollections.id, existingCollection.id));
					activeCollectionId = existingCollection.id;
				} else {
					activeCollectionId = generateId();
					identifier(activeCollectionId);
					await tx.insert(mediaCollections).values({
						id: activeCollectionId,
						serverInstanceId: input.serverInstanceId,
						source: 'tmdb',
						sourceId: collection.id,
						name: collection.name,
						nativeProvider: null,
						metadata: { tmdbCollectionId: collection.id },
						firstSeenAt: observedAt,
						lastSyncedAt: observedAt,
						removedAt: null,
						updatedAt: observedAt
					});
				}
				result.collectionsUpserted++;

				const memberKey = sourceMemberKey(item.tmdbId!, item.id);
				const [existingMembership] = await tx
					.select({ id: collectionMemberships.id })
					.from(collectionMemberships)
					.where(
						and(
							eq(collectionMemberships.serverInstanceId, input.serverInstanceId),
							eq(collectionMemberships.collectionId, activeCollectionId),
							eq(collectionMemberships.source, 'tmdb'),
							eq(collectionMemberships.sourceMemberId, memberKey)
						)
					)
					.limit(1);
				const membership = {
					mediaItemId: item.id,
					title: item.title,
					year: item.year,
					availableLocally: true,
					provenance: {
						sources: ['tmdb'],
						tmdbCollectionId: collection.id,
						tmdbMemberId: item.tmdbId
					},
					lastSeenAt: observedAt,
					removedAt: null
				};
				if (existingMembership) {
					activeMembershipId = existingMembership.id;
					await tx
						.update(collectionMemberships)
						.set(membership)
						.where(eq(collectionMemberships.id, existingMembership.id));
				} else {
					const [insertedMembership] = await tx
						.insert(collectionMemberships)
						.values({
							serverInstanceId: input.serverInstanceId,
							collectionId: activeCollectionId,
							source: 'tmdb',
							sourceMemberId: memberKey,
							firstSeenAt: observedAt,
							...membership
						})
						.returning({ id: collectionMemberships.id });
					activeMembershipId = insertedMembership.id;
				}
				result.membershipsUpserted++;
			}

			// Identity can change while the title remains in the same TMDB collection.
			// Compare the source-qualified membership identity, not just collection id,
			// so the previous TMDB member row is retained only as soft-removed history.
			const obsolete = previous.filter((entry) => entry.id !== activeMembershipId);
			if (obsolete.length) {
				await tx
					.update(collectionMemberships)
					.set({ removedAt: observedAt })
					.where(
						inArray(
							collectionMemberships.id,
							obsolete.map((entry) => entry.id)
						)
					);
				result.membershipsRemoved += obsolete.length;
			}
			await tx
				.update(mediaItems)
				.set({
					tmdbCollectionId: collection?.id ?? null,
					tmdbCollectionName: collection?.name ?? null,
					updatedAt: observedAt
				})
				.where(eq(mediaItems.id, item.id));

			const candidateCollectionIds = [...new Set(obsolete.map((entry) => entry.collectionId))];
			for (const collectionId of candidateCollectionIds) {
				const [activeMembership] = await tx
					.select({ id: collectionMemberships.id })
					.from(collectionMemberships)
					.where(
						and(
							eq(collectionMemberships.collectionId, collectionId),
							isNull(collectionMemberships.removedAt)
						)
					)
					.limit(1);
				if (!activeMembership) {
					await tx
						.update(mediaCollections)
						.set({ removedAt: observedAt, updatedAt: observedAt })
						.where(
							and(
								eq(mediaCollections.id, collectionId),
								eq(mediaCollections.serverInstanceId, input.serverInstanceId),
								eq(mediaCollections.source, 'tmdb')
							)
						);
					result.collectionsRemoved++;
				}
			}
			return result;
		});
	}

	/**
	 * Reconcile items that disappeared from the authoritative server/library read.
	 * TMDB membership is soft-removed, native membership remains as source context
	 * but is explicitly unavailable, and neither the item nor its history is deleted.
	 */
	async function reconcileUnavailableItems(
		input: ReconcileUnavailableItemsInput
	): Promise<CollectionReconciliationResult> {
		const observedAt = checkedDate(input.observedAt ?? clock());
		identifier(input.serverInstanceId);
		const mediaItemIds = [...new Set(input.mediaItemIds)];
		if (mediaItemIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
			throw new CollectionRepositoryError('invalid_collection_observation');
		}
		if (!mediaItemIds.length) {
			await assertServer(input.serverInstanceId);
			return zeroResult();
		}

		return database.transaction(async (tx) => {
			const scopedItems: Array<{ id: number }> = [];
			for (const ids of chunks(mediaItemIds)) {
				scopedItems.push(
					...(await tx
						.select({ id: mediaItems.id })
						.from(mediaItems)
						.where(
							and(
								eq(mediaItems.serverInstanceId, input.serverInstanceId),
								inArray(mediaItems.id, ids)
							)
						))
				);
			}
			if (scopedItems.length !== mediaItemIds.length) {
				throw new CollectionRepositoryError('collection_item_scope_mismatch');
			}

			const activeMemberships: Array<{
				id: number;
				collectionId: string;
				source: CollectionSource;
			}> = [];
			for (const ids of chunks(mediaItemIds)) {
				activeMemberships.push(
					...(await tx
						.select({
							id: collectionMemberships.id,
							collectionId: collectionMemberships.collectionId,
							source: collectionMemberships.source
						})
						.from(collectionMemberships)
						.where(
							and(
								eq(collectionMemberships.serverInstanceId, input.serverInstanceId),
								inArray(collectionMemberships.mediaItemId, ids),
								isNull(collectionMemberships.removedAt)
							)
						))
				);
			}

			const tmdbMemberships = activeMemberships.filter((row) => row.source === 'tmdb');
			const nativeMemberships = activeMemberships.filter((row) => row.source === 'native');
			for (const ids of chunks(tmdbMemberships.map((row) => row.id))) {
				await tx
					.update(collectionMemberships)
					.set({ availableLocally: false, removedAt: observedAt })
					.where(inArray(collectionMemberships.id, ids));
			}
			for (const ids of chunks(nativeMemberships.map((row) => row.id))) {
				await tx
					.update(collectionMemberships)
					.set({ availableLocally: false })
					.where(inArray(collectionMemberships.id, ids));
			}
			for (const ids of chunks(mediaItemIds)) {
				await tx
					.update(mediaItems)
					.set({
						tmdbCollectionId: null,
						tmdbCollectionName: null,
						updatedAt: observedAt
					})
					.where(
						and(
							eq(mediaItems.serverInstanceId, input.serverInstanceId),
							inArray(mediaItems.id, ids)
						)
					);
			}

			const candidateCollectionIds = [...new Set(tmdbMemberships.map((row) => row.collectionId))];
			const collectionsWithActiveMembers = new Set<string>();
			for (const ids of chunks(candidateCollectionIds)) {
				const rows = await tx
					.select({ collectionId: collectionMemberships.collectionId })
					.from(collectionMemberships)
					.where(
						and(
							inArray(collectionMemberships.collectionId, ids),
							isNull(collectionMemberships.removedAt)
						)
					);
				for (const row of rows) collectionsWithActiveMembers.add(row.collectionId);
			}
			const emptyCollectionIds = candidateCollectionIds.filter(
				(id) => !collectionsWithActiveMembers.has(id)
			);
			for (const ids of chunks(emptyCollectionIds)) {
				await tx
					.update(mediaCollections)
					.set({ removedAt: observedAt, updatedAt: observedAt })
					.where(
						and(
							eq(mediaCollections.serverInstanceId, input.serverInstanceId),
							eq(mediaCollections.source, 'tmdb'),
							inArray(mediaCollections.id, ids)
						)
					);
			}

			return {
				collectionsUpserted: 0,
				collectionsRemoved: emptyCollectionIds.length,
				membershipsUpserted: 0,
				membershipsRemoved: tmdbMemberships.length
			};
		});
	}

	async function reconcileNativeCollections(
		input: ReconcileNativeCollectionsInput
	): Promise<CollectionReconciliationResult> {
		const observedAt = checkedDate(input.observedAt ?? clock());
		await assertServer(input.serverInstanceId);
		const collections = normalizeNativeCollectionSnapshot(input.collections);
		return database.transaction(async (tx) => {
			const result = zeroResult();
			const localItems = await tx
				.select({
					id: mediaItems.id,
					ratingKey: mediaItems.ratingKey,
					title: mediaItems.title,
					year: mediaItems.year,
					removedAt: mediaItems.sourceRemovedAt
				})
				.from(mediaItems)
				.where(eq(mediaItems.serverInstanceId, input.serverInstanceId));
			const localBySourceId = new Map(localItems.map((item) => [item.ratingKey, item]));
			const priorCollections = await tx
				.select()
				.from(mediaCollections)
				.where(
					and(
						eq(mediaCollections.serverInstanceId, input.serverInstanceId),
						eq(mediaCollections.source, 'native')
					)
				);
			const priorBySourceId = new Map(priorCollections.map((row) => [row.sourceId, row]));
			const observedSourceIds = new Set<string>();

			for (const observation of collections) {
				observedSourceIds.add(observation.id);
				const prior = priorBySourceId.get(observation.id);
				let collectionId: string;
				const collectionValues = {
					name: observation.name,
					nativeProvider: input.provider,
					currentPosterUrl: sanitizeNativeCollectionArtworkUrl(observation.currentPosterUrl),
					currentBackgroundUrl: sanitizeNativeCollectionArtworkUrl(
						observation.currentBackgroundUrl
					),
					capabilities: observation.capabilities,
					metadata: { libraryKeys: observation.libraryKeys },
					lastSyncedAt: observedAt,
					removedAt: null,
					updatedAt: observedAt
				};
				if (prior) {
					collectionId = prior.id;
					await tx
						.update(mediaCollections)
						.set(collectionValues)
						.where(eq(mediaCollections.id, collectionId));
				} else {
					collectionId = generateId();
					identifier(collectionId);
					await tx.insert(mediaCollections).values({
						id: collectionId,
						serverInstanceId: input.serverInstanceId,
						source: 'native',
						sourceId: observation.id,
						firstSeenAt: observedAt,
						...collectionValues
					});
				}
				result.collectionsUpserted++;

				const observedMemberIds = new Set<string>();
				for (const member of observation.members) {
					observedMemberIds.add(member.id);
					const local = localBySourceId.get(member.id);
					const [existingMembership] = await tx
						.select({ id: collectionMemberships.id })
						.from(collectionMemberships)
						.where(
							and(
								eq(collectionMemberships.serverInstanceId, input.serverInstanceId),
								eq(collectionMemberships.collectionId, collectionId),
								eq(collectionMemberships.source, 'native'),
								eq(collectionMemberships.sourceMemberId, member.id)
							)
						)
						.limit(1);
					const membership = {
						mediaItemId: local?.id ?? null,
						title: local?.title ?? member.title,
						year: local?.year ?? member.year,
						availableLocally: Boolean(local && local.removedAt === null),
						provenance: {
							sources: ['native'],
							provider: input.provider,
							collectionSourceId: observation.id,
							memberSourceId: member.id
						},
						lastSeenAt: observedAt,
						removedAt: null
					};
					if (existingMembership) {
						await tx
							.update(collectionMemberships)
							.set(membership)
							.where(eq(collectionMemberships.id, existingMembership.id));
					} else {
						await tx.insert(collectionMemberships).values({
							serverInstanceId: input.serverInstanceId,
							collectionId,
							source: 'native',
							sourceMemberId: member.id,
							firstSeenAt: observedAt,
							...membership
						});
					}
					result.membershipsUpserted++;
				}

				const activeMembers = await tx
					.select({
						id: collectionMemberships.id,
						sourceMemberId: collectionMemberships.sourceMemberId
					})
					.from(collectionMemberships)
					.where(
						and(
							eq(collectionMemberships.serverInstanceId, input.serverInstanceId),
							eq(collectionMemberships.collectionId, collectionId),
							eq(collectionMemberships.source, 'native'),
							isNull(collectionMemberships.removedAt)
						)
					);
				const priorActiveMembers = activeMembers.filter(
					(member) => !observedMemberIds.has(member.sourceMemberId)
				);
				if (priorActiveMembers.length) {
					for (const ids of chunks(priorActiveMembers.map((row) => row.id))) {
						await tx
							.update(collectionMemberships)
							.set({ removedAt: observedAt })
							.where(inArray(collectionMemberships.id, ids));
					}
					result.membershipsRemoved += priorActiveMembers.length;
				}
			}

			const removedCollections = priorCollections.filter(
				(collection) => !observedSourceIds.has(collection.sourceId) && collection.removedAt === null
			);
			if (removedCollections.length) {
				const ids = removedCollections.map((collection) => collection.id);
				const activeMemberships: Array<{ id: number }> = [];
				for (const collectionIds of chunks(ids)) {
					await tx
						.update(mediaCollections)
						.set({ removedAt: observedAt, updatedAt: observedAt })
						.where(inArray(mediaCollections.id, collectionIds));
					activeMemberships.push(
						...(await tx
							.select({ id: collectionMemberships.id })
							.from(collectionMemberships)
							.where(
								and(
									eq(collectionMemberships.serverInstanceId, input.serverInstanceId),
									inArray(collectionMemberships.collectionId, collectionIds),
									eq(collectionMemberships.source, 'native'),
									isNull(collectionMemberships.removedAt)
								)
							))
					);
				}
				if (activeMemberships.length) {
					for (const membershipIds of chunks(activeMemberships.map((row) => row.id))) {
						await tx
							.update(collectionMemberships)
							.set({ removedAt: observedAt })
							.where(inArray(collectionMemberships.id, membershipIds));
					}
					result.membershipsRemoved += activeMemberships.length;
				}
				result.collectionsRemoved += removedCollections.length;
			}
			return result;
		});
	}

	return {
		reconcileTmdbItemCollection,
		reconcileUnavailableItems,
		reconcileNativeCollections,
		getItemMembershipProvenance
	};
}

export type CollectionRepository = ReturnType<typeof createCollectionRepository>;

import { and, asc, eq, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkSlotStates,
	collectionMemberships,
	mediaCollections,
	mediaItems
} from '$lib/server/db/schema';
import type { CapabilitySupport, ServerType } from '$lib/server/media-server';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';

type Database = LibSQLDatabase<typeof schema>;

export type NativeCollectionArtworkContextErrorCode =
	| 'invalid_native_collection_request'
	| 'collection_not_found';

class NativeCollectionArtworkContextError extends Error {
	constructor(readonly code: NativeCollectionArtworkContextErrorCode) {
		super(code);
		this.name = 'NativeCollectionArtworkContextError';
	}
}

export interface NativeCollectionArtworkContext {
	id: string;
	serverInstanceId: string;
	name: string;
	source: 'tmdb' | 'native';
	sourceId: string;
	nativeProvider: ServerType | null;
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	capabilities: {
		posterWrite: CapabilitySupport;
		backgroundWrite: CapabilitySupport;
	};
	linkedTmdbCollectionId: string | null;
	localMemberCount: number;
	artworkVersions: {
		poster: number;
		background: number;
	};
	entityFingerprint: string;
}

function identifier(value: string): string {
	if (!value || value.trim() !== value || value.length > 255 || value.includes('\u0000')) {
		throw new NativeCollectionArtworkContextError('invalid_native_collection_request');
	}
	return value;
}

function support(value: unknown): CapabilitySupport {
	return value === true || value === 'supported'
		? 'supported'
		: value === false || value === 'unsupported'
			? 'unsupported'
			: 'unknown';
}

function serverType(value: string | null): ServerType | null {
	return value === 'plex' || value === 'jellyfin' || value === 'emby' ? value : null;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Load one exact same-server native entity and derive a conservative TMDB artwork link. */
export async function loadNativeCollectionArtworkContext(
	database: Database,
	serverInstanceId: string,
	mediaCollectionId: string
): Promise<NativeCollectionArtworkContext> {
	const serverId = identifier(serverInstanceId);
	const collectionId = identifier(mediaCollectionId);
	const [collection] = await database
		.select({
			id: mediaCollections.id,
			serverInstanceId: mediaCollections.serverInstanceId,
			name: mediaCollections.name,
			source: mediaCollections.source,
			sourceId: mediaCollections.sourceId,
			nativeProvider: mediaCollections.nativeProvider,
			currentPosterUrl: mediaCollections.currentPosterUrl,
			currentBackgroundUrl: mediaCollections.currentBackgroundUrl,
			capabilities: mediaCollections.capabilities,
			lastSyncedAt: mediaCollections.lastSyncedAt,
			updatedAt: mediaCollections.updatedAt
		})
		.from(mediaCollections)
		.where(
			and(
				eq(mediaCollections.id, collectionId),
				eq(mediaCollections.serverInstanceId, serverId),
				isNull(mediaCollections.removedAt)
			)
		)
		.limit(1);
	if (!collection) throw new NativeCollectionArtworkContextError('collection_not_found');

	const memberships = await database
		.select({
			id: collectionMemberships.id,
			source: collectionMemberships.source,
			sourceMemberId: collectionMemberships.sourceMemberId,
			mediaItemId: collectionMemberships.mediaItemId,
			availableLocally: collectionMemberships.availableLocally,
			itemServerInstanceId: mediaItems.serverInstanceId,
			itemRemovedAt: mediaItems.sourceRemovedAt,
			tmdbCollectionId: mediaItems.tmdbCollectionId
		})
		.from(collectionMemberships)
		.leftJoin(mediaItems, eq(mediaItems.id, collectionMemberships.mediaItemId))
		.where(
			and(
				eq(collectionMemberships.serverInstanceId, serverId),
				eq(collectionMemberships.collectionId, collectionId),
				isNull(collectionMemberships.removedAt)
			)
		)
		.orderBy(
			asc(collectionMemberships.source),
			asc(collectionMemberships.sourceMemberId),
			asc(collectionMemberships.id)
		);
	const localMemberships = memberships.filter(
		(membership) =>
			membership.availableLocally &&
			membership.mediaItemId !== null &&
			membership.itemServerInstanceId === serverId &&
			membership.itemRemovedAt === null
	);
	const localItems = new Map(
		localMemberships.map((membership) => [membership.mediaItemId!, membership.tmdbCollectionId])
	);
	const linkedIds = [...new Set(localItems.values())];
	const linkedTmdbCollectionId =
		localItems.size >= 2 &&
		linkedIds.length === 1 &&
		typeof linkedIds[0] === 'string' &&
		/^[1-9]\d*$/.test(linkedIds[0])
			? linkedIds[0]
			: null;

	const slotStates = await database
		.select({ kind: artworkSlotStates.kind, artworkVersion: artworkSlotStates.artworkVersion })
		.from(artworkSlotStates)
		.where(
			and(
				eq(artworkSlotStates.serverInstanceId, serverId),
				eq(artworkSlotStates.mediaCollectionId, collectionId),
				isNull(artworkSlotStates.mediaItemId),
				isNull(artworkSlotStates.season),
				isNull(artworkSlotStates.episode)
			)
		);
	const version = (kind: 'poster' | 'background') =>
		slotStates.find((state) => state.kind === kind)?.artworkVersion ?? 0;
	const capabilities = record(collection.capabilities);
	const context = {
		id: collection.id,
		serverInstanceId: collection.serverInstanceId,
		name: collection.name,
		source: collection.source,
		sourceId: collection.sourceId,
		nativeProvider: serverType(collection.nativeProvider),
		currentPosterUrl: collection.currentPosterUrl,
		currentBackgroundUrl: collection.currentBackgroundUrl,
		capabilities: {
			posterWrite: support(capabilities.posterWrite),
			backgroundWrite: support(capabilities.backgroundWrite)
		},
		linkedTmdbCollectionId,
		localMemberCount: localItems.size,
		artworkVersions: { poster: version('poster'), background: version('background') }
	};
	return {
		...context,
		entityFingerprint: hashCanonicalJson({
			collection: {
				id: collection.id,
				serverInstanceId: collection.serverInstanceId,
				source: collection.source,
				sourceId: collection.sourceId,
				nativeProvider: collection.nativeProvider,
				capabilities: collection.capabilities,
				lastSyncedAt: collection.lastSyncedAt?.toISOString() ?? null,
				updatedAt: collection.updatedAt.toISOString()
			},
			memberships: memberships.map((membership) => ({
				id: membership.id,
				source: membership.source,
				sourceMemberId: membership.sourceMemberId,
				mediaItemId: membership.mediaItemId,
				availableLocally: membership.availableLocally,
				itemServerInstanceId: membership.itemServerInstanceId,
				itemAvailable: membership.itemRemovedAt === null,
				tmdbCollectionId: membership.tmdbCollectionId
			})),
			linkedTmdbCollectionId,
			artworkVersions: context.artworkVersions
		})
	};
}

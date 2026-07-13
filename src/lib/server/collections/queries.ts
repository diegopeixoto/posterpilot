import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisions,
	collectionMemberships,
	mediaCollections,
	mediaItems,
	posterCandidates
} from '$lib/server/db/schema';
import {
	calculateCollectionConsistency,
	collectionArtworkFamilyKey,
	type CollectionArtworkFamily,
	type CollectionConsistencyCoverage,
	type CollectionConsistencyMemberState
} from './consistency';

type Database = LibSQLDatabase<typeof schema>;
type CollectionSource = 'tmdb' | 'native';

export interface CollectionIndexPreviewMember {
	id: number;
	title: string;
	hasCurrentPoster: boolean;
	hasStagedPoster: boolean;
	artworkVersion: number;
	selectionVersion: number;
}

export interface CollectionIndexEntry {
	id: string;
	name: string;
	source: CollectionSource;
	sourceId: string;
	nativeProvider: string | null;
	localMemberCount: number;
	unavailableMemberCount: number;
	posterArtworkCount: number;
	backgroundArtworkCount: number;
	stagedMemberCount: number;
	previewMembers: CollectionIndexPreviewMember[];
	heroBackgroundItemId: number | null;
	lastSyncedAt: Date | null;
}

export interface CollectionMemberArtworkState {
	current: {
		available: boolean;
		provenance: CollectionArtworkFamily | null;
	};
	staged: {
		available: boolean;
		candidateId: number | null;
		provenance: CollectionArtworkFamily | null;
		version: number;
	};
	consistency: CollectionConsistencyMemberState;
}

export interface CollectionLocalMember {
	id: number;
	title: string;
	year: number | null;
	type: 'movie' | 'show';
	sectionKey: string;
	sources: CollectionSource[];
	artworkVersion: number;
	poster: CollectionMemberArtworkState;
	background: CollectionMemberArtworkState;
}

export interface CollectionUnavailableMember {
	id: number;
	title: string | null;
	year: number | null;
	source: CollectionSource;
	sourceMemberId: string;
}

export interface CollectionDetail {
	id: string;
	serverInstanceId: string;
	name: string;
	source: CollectionSource;
	sourceId: string;
	nativeProvider: string | null;
	firstSeenAt: Date;
	lastSyncedAt: Date | null;
	localMembers: CollectionLocalMember[];
	unavailableMembers: CollectionUnavailableMember[];
	consistency: {
		poster: CollectionConsistencyCoverage;
		background: CollectionConsistencyCoverage;
	};
}

function requiredIdentifier(value: string, label: string): string {
	if (!value || value.trim() !== value || value.includes('\u0000')) {
		throw new TypeError(`${label} is required`);
	}
	return value;
}

function safeText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text && text.length <= 512 ? text : null;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function familyFromValues(values: {
	provider: unknown;
	setId: unknown;
	designFamily: unknown;
	language: unknown;
	setAuthor: unknown;
}): CollectionArtworkFamily | null {
	const family = {
		provider: safeText(values.provider) ?? '',
		setId: safeText(values.setId),
		designFamily: safeText(values.designFamily),
		language: safeText(values.language),
		setAuthor: safeText(values.setAuthor)
	};
	return collectionArtworkFamilyKey(family) ? family : null;
}

function familyFromProvenance(
	sourceProvider: string | null,
	provenance: Record<string, unknown> | null
): CollectionArtworkFamily | null {
	const candidate = safeRecord(provenance?.candidate);
	return familyFromValues({
		provider: sourceProvider ?? provenance?.provider ?? candidate?.provider,
		setId: provenance?.setId ?? candidate?.setId,
		designFamily: provenance?.designFamily ?? candidate?.designFamily,
		language: provenance?.language ?? candidate?.language,
		setAuthor: provenance?.setAuthor ?? candidate?.setAuthor
	});
}

function byReleaseThenTitle(
	left: { year: number | null; title: string | null },
	right: { year: number | null; title: string | null }
): number {
	return (
		(left.year ?? Number.MAX_SAFE_INTEGER) - (right.year ?? Number.MAX_SAFE_INTEGER) ||
		(left.title ?? '').localeCompare(right.title ?? '')
	);
}

export function createCollectionQueries(database: Database) {
	async function membershipRows(serverInstanceId: string, collectionId?: string) {
		const serverId = requiredIdentifier(serverInstanceId, 'Server instance id');
		const requestedCollectionId = collectionId
			? requiredIdentifier(collectionId, 'Collection id')
			: null;
		return database
			.select({
				collectionId: mediaCollections.id,
				collectionName: mediaCollections.name,
				collectionSource: mediaCollections.source,
				collectionSourceId: mediaCollections.sourceId,
				nativeProvider: mediaCollections.nativeProvider,
				firstSeenAt: mediaCollections.firstSeenAt,
				lastSyncedAt: mediaCollections.lastSyncedAt,
				membershipId: collectionMemberships.id,
				membershipSource: collectionMemberships.source,
				sourceMemberId: collectionMemberships.sourceMemberId,
				membershipTitle: collectionMemberships.title,
				membershipYear: collectionMemberships.year,
				availableLocally: collectionMemberships.availableLocally,
				itemId: mediaItems.id,
				itemTitle: mediaItems.title,
				itemYear: mediaItems.year,
				itemType: mediaItems.type,
				sectionKey: mediaItems.sectionKey,
				currentPoster: mediaItems.currentPosterUrl,
				currentBackground: mediaItems.currentBackgroundUrl,
				selectedPoster: mediaItems.selectedPosterUrl,
				selectedBackground: mediaItems.selectedBackgroundUrl,
				selectedPosterCandidateId: mediaItems.selectedPosterCandidateId,
				selectedBackgroundCandidateId: mediaItems.selectedBackgroundCandidateId,
				selectionUpdatedAt: mediaItems.selectionUpdatedAt,
				artworkVersion: mediaItems.artworkVersion
			})
			.from(mediaCollections)
			.leftJoin(
				collectionMemberships,
				and(
					eq(collectionMemberships.collectionId, mediaCollections.id),
					eq(collectionMemberships.serverInstanceId, serverId),
					isNull(collectionMemberships.removedAt)
				)
			)
			.leftJoin(
				mediaItems,
				and(
					eq(mediaItems.id, collectionMemberships.mediaItemId),
					eq(mediaItems.serverInstanceId, serverId),
					isNull(mediaItems.sourceRemovedAt)
				)
			)
			.where(
				and(
					eq(mediaCollections.serverInstanceId, serverId),
					isNull(mediaCollections.removedAt),
					requestedCollectionId ? eq(mediaCollections.id, requestedCollectionId) : undefined
				)
			)
			.orderBy(asc(mediaCollections.name), asc(mediaCollections.id), asc(collectionMemberships.id));
	}

	async function listCollections(serverInstanceId: string): Promise<CollectionIndexEntry[]> {
		const rows = await membershipRows(serverInstanceId);
		const groups = new Map<
			string,
			{
				entry: Omit<
					CollectionIndexEntry,
					| 'localMemberCount'
					| 'unavailableMemberCount'
					| 'posterArtworkCount'
					| 'backgroundArtworkCount'
					| 'stagedMemberCount'
					| 'previewMembers'
					| 'heroBackgroundItemId'
				>;
				local: Map<
					number,
					CollectionIndexPreviewMember & {
						hasBackground: boolean;
						hasCurrentBackground: boolean;
						staged: boolean;
					}
				>;
				unavailable: Set<string>;
			}
		>();

		for (const row of rows) {
			let group = groups.get(row.collectionId);
			if (!group) {
				group = {
					entry: {
						id: row.collectionId,
						name: row.collectionName,
						source: row.collectionSource,
						sourceId: row.collectionSourceId,
						nativeProvider: safeText(row.nativeProvider),
						lastSyncedAt: row.lastSyncedAt
					},
					local: new Map(),
					unavailable: new Set()
				};
				groups.set(row.collectionId, group);
			}
			if (row.membershipId === null) continue;
			if (row.availableLocally && row.itemId !== null && row.itemTitle !== null) {
				group.local.set(row.itemId, {
					id: row.itemId,
					title: row.itemTitle,
					hasCurrentPoster: Boolean(row.currentPoster),
					hasStagedPoster: Boolean(row.selectedPoster),
					artworkVersion: row.artworkVersion ?? 0,
					selectionVersion: row.selectionUpdatedAt?.getTime() ?? 0,
					hasBackground: Boolean(row.currentBackground || row.selectedBackground),
					hasCurrentBackground: Boolean(row.currentBackground),
					staged: Boolean(row.selectedPoster || row.selectedBackground)
				});
			} else {
				group.unavailable.add(`${row.membershipSource}:${row.sourceMemberId}`);
			}
		}

		return [...groups.values()]
			.map(({ entry, local, unavailable }): CollectionIndexEntry => {
				const members = [...local.values()];
				return {
					...entry,
					localMemberCount: members.length,
					unavailableMemberCount: unavailable.size,
					posterArtworkCount: members.filter(
						(member) => member.hasCurrentPoster || member.hasStagedPoster
					).length,
					backgroundArtworkCount: members.filter((member) => member.hasBackground).length,
					stagedMemberCount: members.filter((member) => member.staged).length,
					previewMembers: members
						.slice(0, 4)
						.map(
							({ hasBackground: _, hasCurrentBackground: __, staged: ___, ...member }) => member
						),
					heroBackgroundItemId: members.find((member) => member.hasCurrentBackground)?.id ?? null
				};
			})
			.filter((collection) => collection.localMemberCount >= 2)
			.sort(
				(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
			);
	}

	async function getCollection(
		serverInstanceId: string,
		collectionId: string
	): Promise<CollectionDetail | null> {
		const serverId = requiredIdentifier(serverInstanceId, 'Server instance id');
		const id = requiredIdentifier(collectionId, 'Collection id');
		const rows = await membershipRows(serverId, id);
		if (rows.length === 0) return null;
		const root = rows[0];

		const localRows = new Map<number, (typeof rows)[number] & { sources: Set<CollectionSource> }>();
		const unavailable = new Map<string, CollectionUnavailableMember>();
		for (const row of rows) {
			if (row.membershipId === null) continue;
			if (
				row.availableLocally &&
				row.itemId !== null &&
				row.itemTitle !== null &&
				row.itemType !== null &&
				row.sectionKey !== null
			) {
				const prior = localRows.get(row.itemId);
				if (prior) prior.sources.add(row.membershipSource!);
				else
					localRows.set(row.itemId, {
						...row,
						sources: new Set([row.membershipSource!])
					});
			} else {
				const unavailableId = `${row.membershipSource}:${row.sourceMemberId}`;
				unavailable.set(unavailableId, {
					id: row.membershipId,
					title: row.membershipTitle,
					year: row.membershipYear,
					source: row.membershipSource!,
					sourceMemberId: row.sourceMemberId!
				});
			}
		}

		const itemRows = [...localRows.values()];
		const itemIds = itemRows.map((row) => row.itemId!);
		const selectedCandidateIds = [
			...new Set(
				itemRows.flatMap((row) =>
					[row.selectedPosterCandidateId, row.selectedBackgroundCandidateId].filter(
						(value): value is number => value !== null
					)
				)
			)
		];
		const candidates = selectedCandidateIds.length
			? await database
					.select({
						id: posterCandidates.id,
						mediaItemId: posterCandidates.mediaItemId,
						provider: posterCandidates.provider,
						setId: posterCandidates.setId,
						setAuthor: posterCandidates.setAuthor,
						designFamily: posterCandidates.designFamily,
						language: posterCandidates.language
					})
					.from(posterCandidates)
					.where(
						and(
							eq(posterCandidates.serverInstanceId, serverId),
							inArray(posterCandidates.id, selectedCandidateIds)
						)
					)
			: [];
		const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

		const revisions = itemIds.length
			? await database
					.select({
						id: artworkRevisions.id,
						mediaItemId: artworkRevisions.mediaItemId,
						action: artworkRevisions.action,
						kind: artworkRevisions.kind,
						sourceProvider: artworkRevisions.sourceProvider,
						provenance: artworkRevisions.provenance,
						createdAt: artworkRevisions.createdAt
					})
					.from(artworkRevisions)
					.where(
						and(
							eq(artworkRevisions.serverInstanceId, serverId),
							inArray(artworkRevisions.mediaItemId, itemIds),
							eq(artworkRevisions.destination, 'server'),
							inArray(artworkRevisions.kind, ['poster', 'background']),
							isNull(artworkRevisions.season),
							isNull(artworkRevisions.episode),
							eq(artworkRevisions.outcome, 'success')
						)
					)
					.orderBy(desc(artworkRevisions.createdAt), desc(artworkRevisions.id))
			: [];
		const currentEvidence = new Map<string, CollectionArtworkFamily | null>();
		for (const revision of revisions) {
			if (revision.mediaItemId === null) continue;
			const key = `${revision.mediaItemId}:${revision.kind}`;
			if (currentEvidence.has(key)) continue;
			currentEvidence.set(
				key,
				revision.action === 'apply'
					? familyFromProvenance(revision.sourceProvider, revision.provenance)
					: null
			);
		}

		const memberDrafts = itemRows
			.map((row) => {
				const posterCandidate = row.selectedPosterCandidateId
					? candidateById.get(row.selectedPosterCandidateId)
					: undefined;
				const backgroundCandidate = row.selectedBackgroundCandidateId
					? candidateById.get(row.selectedBackgroundCandidateId)
					: undefined;
				const candidateFamily = (
					candidate: (typeof candidates)[number] | undefined,
					itemId: number
				) =>
					candidate?.mediaItemId === itemId
						? familyFromValues({
								provider: candidate.provider,
								setId: candidate.setId,
								designFamily: candidate.designFamily,
								language: candidate.language,
								setAuthor: candidate.setAuthor
							})
						: null;
				const posterStaged = Boolean(row.selectedPoster);
				const backgroundStaged = Boolean(row.selectedBackground);
				return {
					row,
					poster: {
						currentAvailable: Boolean(row.currentPoster),
						currentFamily: currentEvidence.get(`${row.itemId}:poster`) ?? null,
						stagedAvailable: posterStaged,
						stagedFamily: candidateFamily(posterCandidate, row.itemId!),
						activeFamily: posterStaged
							? candidateFamily(posterCandidate, row.itemId!)
							: (currentEvidence.get(`${row.itemId}:poster`) ?? null),
						activeSource: posterStaged
							? ('staged' as const)
							: row.currentPoster
								? ('current' as const)
								: null
					},
					background: {
						currentAvailable: Boolean(row.currentBackground),
						currentFamily: currentEvidence.get(`${row.itemId}:background`) ?? null,
						stagedAvailable: backgroundStaged,
						stagedFamily: candidateFamily(backgroundCandidate, row.itemId!),
						activeFamily: backgroundStaged
							? candidateFamily(backgroundCandidate, row.itemId!)
							: (currentEvidence.get(`${row.itemId}:background`) ?? null),
						activeSource: backgroundStaged
							? ('staged' as const)
							: row.currentBackground
								? ('current' as const)
								: null
					}
				};
			})
			.sort((left, right) =>
				byReleaseThenTitle(
					{ year: left.row.itemYear, title: left.row.itemTitle },
					{ year: right.row.itemYear, title: right.row.itemTitle }
				)
			);

		const posterCoverage = calculateCollectionConsistency(
			memberDrafts.map(({ row, poster }) => ({
				id: row.itemId!,
				hasArtwork: poster.stagedAvailable || poster.currentAvailable,
				evidence: poster.activeFamily,
				evidenceSource: poster.activeSource
			}))
		);
		const backgroundCoverage = calculateCollectionConsistency(
			memberDrafts.map(({ row, background }) => ({
				id: row.itemId!,
				hasArtwork: background.stagedAvailable || background.currentAvailable,
				evidence: background.activeFamily,
				evidenceSource: background.activeSource
			}))
		);
		const posterState = new Map(posterCoverage.members.map((member) => [member.id, member.state]));
		const backgroundState = new Map(
			backgroundCoverage.members.map((member) => [member.id, member.state])
		);

		return {
			id: root.collectionId,
			serverInstanceId: serverId,
			name: root.collectionName,
			source: root.collectionSource,
			sourceId: root.collectionSourceId,
			nativeProvider: safeText(root.nativeProvider),
			firstSeenAt: root.firstSeenAt,
			lastSyncedAt: root.lastSyncedAt,
			localMembers: memberDrafts.map(({ row, poster, background }) => ({
				id: row.itemId!,
				title: row.itemTitle!,
				year: row.itemYear,
				type: row.itemType!,
				sectionKey: row.sectionKey!,
				sources: [...row.sources].sort(),
				artworkVersion: row.artworkVersion ?? 0,
				poster: {
					current: { available: poster.currentAvailable, provenance: poster.currentFamily },
					staged: {
						available: poster.stagedAvailable,
						candidateId: row.selectedPosterCandidateId,
						provenance: poster.stagedFamily,
						version: row.selectionUpdatedAt?.getTime() ?? 0
					},
					consistency: posterState.get(row.itemId!) ?? 'unknown_provenance'
				},
				background: {
					current: { available: background.currentAvailable, provenance: background.currentFamily },
					staged: {
						available: background.stagedAvailable,
						candidateId: row.selectedBackgroundCandidateId,
						provenance: background.stagedFamily,
						version: row.selectionUpdatedAt?.getTime() ?? 0
					},
					consistency: backgroundState.get(row.itemId!) ?? 'unknown_provenance'
				}
			})),
			unavailableMembers: [...unavailable.values()].sort(byReleaseThenTitle),
			consistency: { poster: posterCoverage, background: backgroundCoverage }
		};
	}

	return { listCollections, getCollection };
}

export type CollectionQueries = ReturnType<typeof createCollectionQueries>;

let liveQueries: CollectionQueries | null = null;

/** Keep the injected query factory import-time `$env`-free for focused tests. */
async function runtimeQueries(): Promise<CollectionQueries> {
	if (!liveQueries) {
		const { db } = await import('$lib/server/db');
		liveQueries = createCollectionQueries(db);
	}
	return liveQueries;
}

export const listCollections = async (serverInstanceId: string) =>
	(await runtimeQueries()).listCollections(serverInstanceId);
export const getCollection = async (serverInstanceId: string, collectionId: string) =>
	(await runtimeQueries()).getCollection(serverInstanceId, collectionId);

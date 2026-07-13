import { Buffer } from 'node:buffer';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisionGroups,
	artworkRevisions,
	artworkSnapshots,
	artworkSlotStates,
	mediaItems
} from '$lib/server/db/schema';

type Database = LibSQLDatabase<typeof schema>;

const ARTWORK_HISTORY_DEFAULT_LIMIT = 50;
export const ARTWORK_HISTORY_MAX_LIMIT = 100;

export type ArtworkHistoryDestination = 'server' | 'kometa';
export type ArtworkHistoryKind = 'poster' | 'background' | 'title_card';

export interface ArtworkRevisionHistoryQuery {
	destination?: ArtworkHistoryDestination;
	kind?: ArtworkHistoryKind;
	/** `null` selects item-root revisions; `undefined` leaves the season unfiltered. */
	season?: number | null;
	episode?: number;
	groupId?: string;
	cursor?: string;
	limit: number;
}

export type ArtworkRevisionHistoryQueryErrorCode =
	| 'invalid_destination'
	| 'invalid_kind'
	| 'invalid_season'
	| 'invalid_episode'
	| 'episode_requires_season'
	| 'invalid_group'
	| 'invalid_cursor'
	| 'invalid_limit';

/** Locale-neutral validation error for route adapters. */
export class ArtworkRevisionHistoryQueryError extends Error {
	constructor(
		readonly code: ArtworkRevisionHistoryQueryErrorCode,
		readonly field: string
	) {
		super(code);
		this.name = 'ArtworkRevisionHistoryQueryError';
	}
}

export interface PublicArtworkCandidateProvenance {
	id: number | null;
	provider: string | null;
	providerAssetId: string | null;
	setId: string | null;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	width: number | null;
	height: number | null;
	score: number | null;
	resolvedTmdbId: string | null;
	resolvedMediaType: 'movie' | 'tv' | null;
}

/** Explicit allowlist: arbitrary provenance keys and candidate URLs never enter the DTO. */
export interface PublicArtworkProvenance {
	selectionSource: 'auto' | 'stored' | null;
	sourceMediaItemId: number | null;
	providerAssetId: string | null;
	setId: string | null;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	discoveryRunId: string | null;
	resolvedTmdbId: string | null;
	resolvedMediaType: 'movie' | 'tv' | null;
	score: number | null;
	width: number | null;
	height: number | null;
	candidate: PublicArtworkCandidateProvenance | null;
}

export interface PublicArtworkSlotState {
	artworkVersion: number;
	lastObservedAt: string | null;
	lastVerifiedAt: string | null;
	externalChangedAt: string | null;
}

export interface PublicArtworkRevisionGroup {
	id: string;
	kind: 'apply' | 'undo' | 'external_observation';
	initiator: string;
	outcome: 'pending' | 'success' | 'partial' | 'failed';
	jobId: number | null;
	createdAt: string;
	completedAt: string | null;
}

export interface PublicArtworkRevision {
	id: string;
	groupId: string;
	undoOfRevisionId: string | null;
	action: 'apply' | 'undo' | 'external_observation';
	destination: ArtworkHistoryDestination;
	kind: ArtworkHistoryKind;
	season: number | null;
	episode: number | null;
	applyMethod: string | null;
	sourceProvider: string | null;
	provenance: PublicArtworkProvenance | null;
	outcome: 'pending' | 'success' | 'failed' | 'skipped';
	verification: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	error: { code: string } | null;
	hasPriorState: boolean;
	hasResultState: boolean;
	originalProtected: boolean;
	undoAvailable: boolean;
	createdAt: string;
	completedAt: string | null;
	currentSlotState: PublicArtworkSlotState | null;
}

export interface PublicArtworkRevisionHistoryEntry {
	group: PublicArtworkRevisionGroup;
	revision: PublicArtworkRevision;
}

export interface PublicArtworkRevisionHistoryPage {
	item: { id: number; type: 'movie' | 'show'; title: string };
	entries: PublicArtworkRevisionHistoryEntry[];
	nextCursor: string | null;
}

interface DecodedCursor {
	createdAt: Date;
	revisionId: string;
}

const DESTINATIONS = new Set<ArtworkHistoryDestination>(['server', 'kometa']);
const KINDS = new Set<ArtworkHistoryKind>(['poster', 'background', 'title_card']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,96}$/;
const UNSAFE_PUBLIC_TEXT =
	/(?:[a-z][a-z0-9+.-]*:\/\/|(?:token|api[_-]?key|secret|password|authorization|credential)\s*[:=]|bearer\s+|-----BEGIN|\/(?:Users|home|var|etc|config|data)\/)/i;

function queryError(code: ArtworkRevisionHistoryQueryErrorCode, field: string): never {
	throw new ArtworkRevisionHistoryQueryError(code, field);
}

function parseBoundedInteger(
	value: string,
	field: 'season' | 'episode',
	maximum = 100_000
): number {
	if (!/^\d+$/.test(value))
		queryError(field === 'season' ? 'invalid_season' : 'invalid_episode', field);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
		queryError(field === 'season' ? 'invalid_season' : 'invalid_episode', field);
	}
	return parsed;
}

/** Parse and bound the public query contract without importing `$env` or the live database. */
export function parseArtworkRevisionHistoryQuery(
	params: URLSearchParams
): ArtworkRevisionHistoryQuery {
	const query: ArtworkRevisionHistoryQuery = { limit: ARTWORK_HISTORY_DEFAULT_LIMIT };
	const destination = params.get('destination');
	if (destination !== null) {
		if (!DESTINATIONS.has(destination as ArtworkHistoryDestination)) {
			queryError('invalid_destination', 'destination');
		}
		query.destination = destination as ArtworkHistoryDestination;
	}

	const kind = params.get('kind');
	if (kind !== null) {
		if (!KINDS.has(kind as ArtworkHistoryKind)) queryError('invalid_kind', 'kind');
		query.kind = kind as ArtworkHistoryKind;
	}

	const season = params.get('season');
	if (season !== null) {
		query.season = season === 'root' ? null : parseBoundedInteger(season, 'season');
	}

	const episode = params.get('episode');
	if (episode !== null) {
		if (query.season === undefined || query.season === null) {
			queryError('episode_requires_season', 'episode');
		}
		query.episode = parseBoundedInteger(episode, 'episode');
	}

	const group = params.get('group');
	const groupAlias = params.get('groupId');
	if (group !== null && groupAlias !== null && group !== groupAlias) {
		queryError('invalid_group', 'group');
	}
	const groupId = group ?? groupAlias;
	if (groupId !== null) {
		if (!SAFE_IDENTIFIER.test(groupId)) queryError('invalid_group', 'group');
		query.groupId = groupId;
	}

	const cursor = params.get('cursor');
	if (cursor !== null) {
		decodeArtworkRevisionHistoryCursor(cursor);
		query.cursor = cursor;
	}

	const limit = params.get('limit');
	if (limit !== null) {
		if (!/^\d+$/.test(limit)) queryError('invalid_limit', 'limit');
		const parsed = Number(limit);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > ARTWORK_HISTORY_MAX_LIMIT) {
			queryError('invalid_limit', 'limit');
		}
		query.limit = parsed;
	}

	return query;
}

function encodeArtworkRevisionHistoryCursor(createdAt: Date, revisionId: string): string {
	if (!Number.isFinite(createdAt.getTime()) || !SAFE_IDENTIFIER.test(revisionId)) {
		throw new TypeError('Invalid artwork revision history cursor values');
	}
	return Buffer.from(
		JSON.stringify({ version: 1, createdAt: createdAt.getTime(), revisionId }),
		'utf8'
	).toString('base64url');
}

export function decodeArtworkRevisionHistoryCursor(cursor: string): DecodedCursor {
	if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
		queryError('invalid_cursor', 'cursor');
	}
	try {
		const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
			version?: unknown;
			createdAt?: unknown;
			revisionId?: unknown;
		};
		if (
			parsed.version !== 1 ||
			typeof parsed.createdAt !== 'number' ||
			!Number.isSafeInteger(parsed.createdAt) ||
			parsed.createdAt < 0 ||
			typeof parsed.revisionId !== 'string' ||
			!SAFE_IDENTIFIER.test(parsed.revisionId)
		) {
			queryError('invalid_cursor', 'cursor');
		}
		const createdAt = new Date(parsed.createdAt);
		if (!Number.isFinite(createdAt.getTime())) queryError('invalid_cursor', 'cursor');
		return { createdAt, revisionId: parsed.revisionId };
	} catch (error) {
		if (error instanceof ArtworkRevisionHistoryQueryError) throw error;
		queryError('invalid_cursor', 'cursor');
	}
}

function iso(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safePublicText(value: unknown, maximum = 256): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!text || text.length > maximum || UNSAFE_PUBLIC_TEXT.test(text)) return null;
	return text;
}

function safeCode(value: unknown): string | null {
	return typeof value === 'string' && SAFE_CODE.test(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function publicCandidate(value: unknown): PublicArtworkCandidateProvenance | null {
	const candidate = record(value);
	if (!candidate) return null;
	const mediaType = candidate.resolvedMediaType;
	return {
		id: integer(candidate.id),
		provider: safeCode(candidate.provider),
		providerAssetId: safePublicText(candidate.providerAssetId),
		setId: safePublicText(candidate.setId),
		setAuthor: safePublicText(candidate.setAuthor),
		designFamily: safePublicText(candidate.designFamily),
		language: safeCode(candidate.language),
		width: integer(candidate.width),
		height: integer(candidate.height),
		score: finiteNumber(candidate.score),
		resolvedTmdbId: safePublicText(candidate.resolvedTmdbId),
		resolvedMediaType: mediaType === 'movie' || mediaType === 'tv' ? mediaType : null
	};
}

function toPublicArtworkProvenance(value: unknown): PublicArtworkProvenance | null {
	const provenance = record(value);
	if (!provenance) return null;
	const sourceItem = record(provenance.sourceItem);
	const selectionSource = provenance.selectionSource;
	const resolvedMediaType = provenance.resolvedMediaType;
	return {
		selectionSource:
			selectionSource === 'auto' || selectionSource === 'stored' ? selectionSource : null,
		sourceMediaItemId: integer(sourceItem?.mediaItemId),
		providerAssetId: safePublicText(provenance.providerAssetId),
		setId: safePublicText(provenance.setId),
		setAuthor: safePublicText(provenance.setAuthor),
		designFamily: safePublicText(provenance.designFamily),
		language: safeCode(provenance.language),
		discoveryRunId: safePublicText(provenance.discoveryRunId),
		resolvedTmdbId: safePublicText(provenance.resolvedTmdbId),
		resolvedMediaType:
			resolvedMediaType === 'movie' || resolvedMediaType === 'tv' ? resolvedMediaType : null,
		score: finiteNumber(provenance.score),
		width: integer(provenance.width),
		height: integer(provenance.height),
		candidate: publicCandidate(provenance.candidate)
	};
}

function validateListInput(input: {
	serverInstanceId: string;
	mediaItemId: number;
	query: ArtworkRevisionHistoryQuery;
}): void {
	if (!input.serverInstanceId || input.serverInstanceId.trim() !== input.serverInstanceId) {
		throw new TypeError('Server instance id must be a non-empty, trimmed string');
	}
	if (!Number.isSafeInteger(input.mediaItemId) || input.mediaItemId <= 0) {
		throw new TypeError('Media item id must be a positive integer');
	}
	if (
		!Number.isInteger(input.query.limit) ||
		input.query.limit < 1 ||
		input.query.limit > ARTWORK_HISTORY_MAX_LIMIT
	) {
		queryError('invalid_limit', 'limit');
	}
}

/**
 * Read-only, server-scoped history repository. The projection intentionally never
 * selects snapshot values/paths, raw errors, current URLs, or fingerprints.
 */
export function createArtworkRevisionHistoryRepository(database: Database) {
	async function listItemHistory(input: {
		serverInstanceId: string;
		mediaItemId: number;
		query: ArtworkRevisionHistoryQuery;
	}): Promise<PublicArtworkRevisionHistoryPage | null> {
		validateListInput(input);
		const item = (
			await database
				.select({ id: mediaItems.id, type: mediaItems.type, title: mediaItems.title })
				.from(mediaItems)
				.where(
					and(
						eq(mediaItems.id, input.mediaItemId),
						eq(mediaItems.serverInstanceId, input.serverInstanceId)
					)
				)
				.limit(1)
		)[0];
		if (!item) return null;

		const conditions: SQL[] = [
			eq(artworkRevisions.serverInstanceId, input.serverInstanceId),
			eq(artworkRevisionGroups.serverInstanceId, input.serverInstanceId),
			eq(artworkRevisions.mediaItemId, input.mediaItemId),
			isNull(artworkRevisions.mediaCollectionId)
		];
		if (input.query.destination) {
			conditions.push(eq(artworkRevisions.destination, input.query.destination));
		}
		if (input.query.kind) conditions.push(eq(artworkRevisions.kind, input.query.kind));
		if (input.query.season !== undefined) {
			conditions.push(
				input.query.season === null
					? isNull(artworkRevisions.season)
					: eq(artworkRevisions.season, input.query.season)
			);
		}
		if (input.query.episode !== undefined) {
			conditions.push(eq(artworkRevisions.episode, input.query.episode));
		}
		if (input.query.groupId) conditions.push(eq(artworkRevisions.groupId, input.query.groupId));
		if (input.query.cursor) {
			const cursor = decodeArtworkRevisionHistoryCursor(input.query.cursor);
			conditions.push(
				or(
					lt(artworkRevisions.createdAt, cursor.createdAt),
					and(
						eq(artworkRevisions.createdAt, cursor.createdAt),
						lt(artworkRevisions.id, cursor.revisionId)
					)
				)!
			);
		}

		const rows = await database
			.select({
				group: {
					id: artworkRevisionGroups.id,
					kind: artworkRevisionGroups.kind,
					initiator: artworkRevisionGroups.initiator,
					outcome: artworkRevisionGroups.outcome,
					jobId: artworkRevisionGroups.jobId,
					createdAt: artworkRevisionGroups.createdAt,
					completedAt: artworkRevisionGroups.completedAt
				},
				revision: {
					id: artworkRevisions.id,
					groupId: artworkRevisions.groupId,
					undoOfRevisionId: artworkRevisions.undoOfRevisionId,
					beforeSnapshotId: artworkRevisions.beforeSnapshotId,
					afterSnapshotId: artworkRevisions.afterSnapshotId,
					action: artworkRevisions.action,
					destination: artworkRevisions.destination,
					kind: artworkRevisions.kind,
					season: artworkRevisions.season,
					episode: artworkRevisions.episode,
					applyMethod: artworkRevisions.applyMethod,
					sourceProvider: artworkRevisions.sourceProvider,
					provenance: artworkRevisions.provenance,
					outcome: artworkRevisions.outcome,
					verification: artworkRevisions.verification,
					errorCode: artworkRevisions.errorCode,
					createdAt: artworkRevisions.createdAt,
					completedAt: artworkRevisions.completedAt
				},
				state: {
					id: artworkSlotStates.id,
					artworkVersion: artworkSlotStates.artworkVersion,
					lastObservedAt: artworkSlotStates.lastObservedAt,
					lastVerifiedAt: artworkSlotStates.lastVerifiedAt,
					externalChangedAt: artworkSlotStates.externalChangedAt
				}
			})
			.from(artworkRevisions)
			.innerJoin(artworkRevisionGroups, eq(artworkRevisionGroups.id, artworkRevisions.groupId))
			.leftJoin(
				artworkSlotStates,
				and(
					eq(artworkSlotStates.serverInstanceId, artworkRevisions.serverInstanceId),
					eq(artworkSlotStates.mediaItemId, artworkRevisions.mediaItemId),
					isNull(artworkSlotStates.mediaCollectionId),
					eq(artworkSlotStates.kind, artworkRevisions.kind),
					sql`${artworkSlotStates.season} is ${artworkRevisions.season}`,
					sql`${artworkSlotStates.episode} is ${artworkRevisions.episode}`
				)
			)
			.where(and(...conditions))
			.orderBy(desc(artworkRevisions.createdAt), desc(artworkRevisions.id))
			.limit(input.query.limit + 1);

		const hasMore = rows.length > input.query.limit;
		const pageRows = hasMore ? rows.slice(0, input.query.limit) : rows;
		const revisionIds = pageRows.map((row) => row.revision.id);
		const beforeSnapshotIds = pageRows
			.map((row) => row.revision.beforeSnapshotId)
			.filter((id): id is string => id !== null);
		const [undoRows, beforeStates, originalStates] = await Promise.all([
			revisionIds.length
				? database
						.select({ revisionId: artworkRevisions.undoOfRevisionId })
						.from(artworkRevisions)
						.where(
							and(
								eq(artworkRevisions.serverInstanceId, input.serverInstanceId),
								inArray(artworkRevisions.undoOfRevisionId, revisionIds),
								eq(artworkRevisions.outcome, 'success')
							)
						)
				: Promise.resolve([]),
			beforeSnapshotIds.length
				? database
						.select({ id: artworkSnapshots.id, state: artworkSnapshots.state })
						.from(artworkSnapshots)
						.where(
							and(
								eq(artworkSnapshots.serverInstanceId, input.serverInstanceId),
								inArray(artworkSnapshots.id, beforeSnapshotIds)
							)
						)
				: Promise.resolve([]),
			database
				.select({
					destination: artworkSnapshots.destination,
					kind: artworkSnapshots.kind,
					season: artworkSnapshots.season,
					episode: artworkSnapshots.episode
				})
				.from(artworkSnapshots)
				.where(
					and(
						eq(artworkSnapshots.serverInstanceId, input.serverInstanceId),
						eq(artworkSnapshots.mediaItemId, input.mediaItemId),
						isNull(artworkSnapshots.mediaCollectionId),
						eq(artworkSnapshots.isOriginal, true)
					)
				)
		]);
		const undone = new Set(
			undoRows.map((row) => row.revisionId).filter((id): id is string => id !== null)
		);
		const beforeState = new Map(beforeStates.map((snapshot) => [snapshot.id, snapshot.state]));
		const originalSlots = new Set(
			originalStates.map(
				(snapshot) =>
					`${snapshot.destination}:${snapshot.kind}:${snapshot.season ?? 'root'}:${snapshot.episode ?? 'root'}`
			)
		);
		const entries: PublicArtworkRevisionHistoryEntry[] = pageRows.map((row) => {
			const errorCode = safeCode(row.revision.errorCode);
			const error =
				errorCode !== null
					? { code: errorCode }
					: row.revision.outcome === 'failed'
						? { code: 'revision_failed' }
						: null;
			const state = row.revision.destination === 'server' && row.state !== null ? row.state : null;
			const priorState = row.revision.beforeSnapshotId
				? beforeState.get(row.revision.beforeSnapshotId)
				: null;
			return {
				group: {
					id: row.group.id,
					kind: row.group.kind,
					initiator: safeCode(row.group.initiator) ?? 'unknown',
					outcome: row.group.outcome,
					jobId: row.group.jobId,
					createdAt: row.group.createdAt.toISOString(),
					completedAt: iso(row.group.completedAt)
				},
				revision: {
					id: row.revision.id,
					groupId: row.revision.groupId,
					undoOfRevisionId: row.revision.undoOfRevisionId,
					action: row.revision.action,
					destination: row.revision.destination,
					kind: row.revision.kind,
					season: row.revision.season,
					episode: row.revision.episode,
					applyMethod: safeCode(row.revision.applyMethod),
					sourceProvider: safeCode(row.revision.sourceProvider),
					provenance: toPublicArtworkProvenance(row.revision.provenance),
					outcome: row.revision.outcome,
					verification: row.revision.verification,
					error,
					hasPriorState: row.revision.beforeSnapshotId !== null,
					hasResultState: row.revision.afterSnapshotId !== null,
					originalProtected: originalSlots.has(
						`${row.revision.destination}:${row.revision.kind}:${row.revision.season ?? 'root'}:${row.revision.episode ?? 'root'}`
					),
					undoAvailable:
						priorState !== null &&
						priorState !== 'unavailable' &&
						row.revision.afterSnapshotId !== null &&
						row.revision.outcome !== 'pending' &&
						!undone.has(row.revision.id),
					createdAt: row.revision.createdAt.toISOString(),
					completedAt: iso(row.revision.completedAt),
					currentSlotState: state
						? {
								artworkVersion: state.artworkVersion,
								lastObservedAt: iso(state.lastObservedAt),
								lastVerifiedAt: iso(state.lastVerifiedAt),
								externalChangedAt: iso(state.externalChangedAt)
							}
						: null
				}
			};
		});
		const last = entries.at(-1);
		return {
			item,
			entries,
			nextCursor:
				hasMore && last
					? encodeArtworkRevisionHistoryCursor(new Date(last.revision.createdAt), last.revision.id)
					: null
		};
	}

	return { listItemHistory };
}

export type ArtworkRevisionHistoryRepository = ReturnType<
	typeof createArtworkRevisionHistoryRepository
>;

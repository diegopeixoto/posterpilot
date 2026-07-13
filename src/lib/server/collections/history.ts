import { and, desc, eq, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisionGroups,
	artworkRevisions,
	mediaItems,
	operationPlans
} from '$lib/server/db/schema';
import { assertApplyPlanPayload } from '$lib/server/plans/apply-plan-validation';
import type { ApplyPlanPayloadV1 } from '$lib/server/plans/apply-plan';
import { decodeOperationPlanPayload } from '$lib/server/plans/operation-plan-payload';

type Database = LibSQLDatabase<typeof schema>;

export interface CollectionRevisionGroup {
	id: string;
	serverInstanceId: string;
	operationPlanId: string | null;
	jobId: number | null;
	outcome: 'pending' | 'success' | 'partial' | 'failed';
	createdAt: Date;
	completedAt: Date | null;
	revisionCount: number;
	memberCount: number;
	anchorItemId: number | null;
	revisions: CollectionRevisionEntry[];
}

export interface CollectionRevisionEntry {
	id: string;
	mediaItemId: number | null;
	mediaCollectionId: string | null;
	memberTitle: string | null;
	destination: 'server' | 'kometa';
	kind: 'poster' | 'background' | 'title_card';
	season: number | null;
	episode: number | null;
	outcome: 'pending' | 'success' | 'failed' | 'skipped';
	verification: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	createdAt: Date;
	restorable: boolean;
	restored: boolean;
}

function identifier(value: string): string {
	if (!value || value.trim() !== value || value.length > 255 || value.includes('\u0000')) {
		throw new TypeError('invalid_collection_history_scope');
	}
	return value;
}

interface CollectionHistoryScope {
	collectionId: string;
	targetItemIds: number[];
}

function summaryCollectionScope(
	summary: Record<string, unknown> | null
): CollectionHistoryScope | null {
	const value = summary?.collectionHistory;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const collectionId = Reflect.get(value, 'collectionId');
	const targetItemIds = Reflect.get(value, 'targetItemIds');
	if (
		typeof collectionId !== 'string' ||
		collectionId.length === 0 ||
		!Array.isArray(targetItemIds) ||
		targetItemIds.some((itemId) => !Number.isSafeInteger(itemId) || itemId <= 0)
	) {
		return null;
	}
	return { collectionId, targetItemIds: [...new Set(targetItemIds as number[])] };
}

function collectionPlanContext(
	payload: string,
	decodePayload: (storedPayload: string) => string
): CollectionHistoryScope | null {
	try {
		const parsed = JSON.parse(decodePayload(payload)) as ApplyPlanPayloadV1;
		assertApplyPlanPayload(parsed);
		return parsed.context.source === 'collection'
			? {
					collectionId: parsed.context.collectionId,
					targetItemIds: parsed.scope.targetItemIds
				}
			: null;
	} catch {
		return null;
	}
}

function collectionScope(
	summary: Record<string, unknown> | null,
	payload: string | null,
	decodePayload: (storedPayload: string) => string
): CollectionHistoryScope | null {
	return (
		summaryCollectionScope(summary) ??
		(payload === null ? null : collectionPlanContext(payload, decodePayload))
	);
}

async function revisionEntriesByGroup(database: Database, groupIds: string[]) {
	const entries = new Map<string, CollectionRevisionEntry[]>();
	if (!groupIds.length) return entries;
	const rows = await database
		.select({
			groupId: artworkRevisions.groupId,
			id: artworkRevisions.id,
			mediaItemId: artworkRevisions.mediaItemId,
			mediaCollectionId: artworkRevisions.mediaCollectionId,
			memberTitle: mediaItems.title,
			beforeSnapshotId: artworkRevisions.beforeSnapshotId,
			destination: artworkRevisions.destination,
			kind: artworkRevisions.kind,
			season: artworkRevisions.season,
			episode: artworkRevisions.episode,
			outcome: artworkRevisions.outcome,
			verification: artworkRevisions.verification,
			createdAt: artworkRevisions.createdAt
		})
		.from(artworkRevisions)
		.leftJoin(mediaItems, eq(mediaItems.id, artworkRevisions.mediaItemId))
		.where(inArray(artworkRevisions.groupId, groupIds))
		.orderBy(desc(artworkRevisions.createdAt), desc(artworkRevisions.id));
	const revisionIds = rows.map((row) => row.id);
	const restoredRows = revisionIds.length
		? await database
				.select({ revisionId: artworkRevisions.undoOfRevisionId })
				.from(artworkRevisions)
				.where(
					and(
						eq(artworkRevisions.action, 'undo'),
						eq(artworkRevisions.outcome, 'success'),
						inArray(artworkRevisions.undoOfRevisionId, revisionIds)
					)
				)
		: [];
	const restored = new Set(
		restoredRows.flatMap((row) => (row.revisionId === null ? [] : [row.revisionId]))
	);
	for (const row of rows) {
		const wasRestored = restored.has(row.id);
		const entry: CollectionRevisionEntry = {
			id: row.id,
			mediaItemId: row.mediaItemId,
			mediaCollectionId: row.mediaCollectionId,
			memberTitle: row.memberTitle,
			destination: row.destination,
			kind: row.kind,
			season: row.season,
			episode: row.episode,
			outcome: row.outcome,
			verification: row.verification,
			createdAt: row.createdAt,
			restorable: row.outcome === 'success' && row.beforeSnapshotId !== null && !wasRestored,
			restored: wasRestored
		};
		entries.set(row.groupId, [...(entries.get(row.groupId) ?? []), entry]);
	}
	return entries;
}

export function createCollectionHistory(
	database: Database,
	decodePayload: (storedPayload: string) => string = decodeOperationPlanPayload
) {
	async function list(
		serverInstanceId: string,
		collectionId: string,
		limit = 50
	): Promise<CollectionRevisionGroup[]> {
		const serverId = identifier(serverInstanceId);
		const id = identifier(collectionId);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
			throw new TypeError('invalid_collection_history_limit');
		}
		const rows = await database
			.select({
				id: artworkRevisionGroups.id,
				serverInstanceId: artworkRevisionGroups.serverInstanceId,
				operationPlanId: artworkRevisionGroups.operationPlanId,
				jobId: artworkRevisionGroups.jobId,
				outcome: artworkRevisionGroups.outcome,
				createdAt: artworkRevisionGroups.createdAt,
				completedAt: artworkRevisionGroups.completedAt,
				summary: artworkRevisionGroups.summary,
				payload: operationPlans.payload
			})
			.from(artworkRevisionGroups)
			.leftJoin(operationPlans, eq(operationPlans.id, artworkRevisionGroups.operationPlanId))
			.where(
				and(
					eq(artworkRevisionGroups.serverInstanceId, serverId),
					eq(artworkRevisionGroups.kind, 'apply')
				)
			)
			.orderBy(desc(artworkRevisionGroups.createdAt), desc(artworkRevisionGroups.id));
		const scoped = rows
			.flatMap((row) => {
				const scope = collectionScope(row.summary, row.payload, decodePayload);
				return scope?.collectionId === id ? [{ row, scope }] : [];
			})
			.slice(0, limit);
		if (!scoped.length) return [];
		const revisionsByGroup = await revisionEntriesByGroup(
			database,
			scoped.map(({ row }) => row.id)
		);
		return scoped.map(({ row, scope }) => {
			const plannedMemberIds = new Set(scope.targetItemIds);
			const groupRevisions = (revisionsByGroup.get(row.id) ?? []).filter(
				(revision) => revision.mediaItemId !== null && plannedMemberIds.has(revision.mediaItemId)
			);
			const memberIds = [
				...new Set(
					groupRevisions.flatMap((revision) =>
						revision.mediaItemId === null ? [] : [revision.mediaItemId]
					)
				)
			].sort((left, right) => left - right);
			const restorableMemberIds = [
				...new Set(
					groupRevisions.flatMap((revision) =>
						revision.restorable && revision.mediaItemId !== null ? [revision.mediaItemId] : []
					)
				)
			].sort((left, right) => left - right);
			return {
				id: row.id,
				serverInstanceId: row.serverInstanceId,
				operationPlanId: row.operationPlanId,
				jobId: row.jobId,
				outcome: row.outcome,
				createdAt: row.createdAt,
				completedAt: row.completedAt,
				revisionCount: groupRevisions.length,
				memberCount: memberIds.length,
				anchorItemId: restorableMemberIds[0] ?? memberIds[0] ?? null,
				revisions: groupRevisions
			};
		});
	}

	async function get(
		serverInstanceId: string,
		collectionId: string,
		groupId: string
	): Promise<CollectionRevisionGroup | null> {
		const serverId = identifier(serverInstanceId);
		const id = identifier(collectionId);
		const requestedGroupId = identifier(groupId);
		const [row] = await database
			.select({
				id: artworkRevisionGroups.id,
				serverInstanceId: artworkRevisionGroups.serverInstanceId,
				operationPlanId: artworkRevisionGroups.operationPlanId,
				jobId: artworkRevisionGroups.jobId,
				outcome: artworkRevisionGroups.outcome,
				createdAt: artworkRevisionGroups.createdAt,
				completedAt: artworkRevisionGroups.completedAt,
				summary: artworkRevisionGroups.summary,
				payload: operationPlans.payload
			})
			.from(artworkRevisionGroups)
			.leftJoin(operationPlans, eq(operationPlans.id, artworkRevisionGroups.operationPlanId))
			.where(
				and(
					eq(artworkRevisionGroups.id, requestedGroupId),
					eq(artworkRevisionGroups.serverInstanceId, serverId),
					eq(artworkRevisionGroups.kind, 'apply')
				)
			)
			.limit(1);
		const scope = row ? collectionScope(row.summary, row.payload, decodePayload) : null;
		if (!row || scope?.collectionId !== id) {
			return null;
		}
		const plannedMemberIds = new Set(scope.targetItemIds);
		const revisions = ((await revisionEntriesByGroup(database, [row.id])).get(row.id) ?? []).filter(
			(revision) => revision.mediaItemId !== null && plannedMemberIds.has(revision.mediaItemId)
		);
		const memberIds = [
			...new Set(
				revisions.flatMap((revision) =>
					revision.mediaItemId === null ? [] : [revision.mediaItemId]
				)
			)
		].sort((left, right) => left - right);
		const restorableMemberIds = [
			...new Set(
				revisions.flatMap((revision) =>
					revision.restorable && revision.mediaItemId !== null ? [revision.mediaItemId] : []
				)
			)
		].sort((left, right) => left - right);
		return {
			id: row.id,
			serverInstanceId: row.serverInstanceId,
			operationPlanId: row.operationPlanId,
			jobId: row.jobId,
			outcome: row.outcome,
			createdAt: row.createdAt,
			completedAt: row.completedAt,
			revisionCount: revisions.length,
			memberCount: memberIds.length,
			anchorItemId: restorableMemberIds[0] ?? memberIds[0] ?? null,
			revisions
		};
	}

	async function getRevision(
		serverInstanceId: string,
		collectionId: string,
		revisionId: string
	): Promise<{ group: CollectionRevisionGroup; revision: CollectionRevisionEntry } | null> {
		const serverId = identifier(serverInstanceId);
		const id = identifier(collectionId);
		const requestedRevisionId = identifier(revisionId);
		const [row] = await database
			.select({ groupId: artworkRevisions.groupId })
			.from(artworkRevisions)
			.where(
				and(
					eq(artworkRevisions.id, requestedRevisionId),
					eq(artworkRevisions.serverInstanceId, serverId)
				)
			)
			.limit(1);
		if (!row) return null;
		const group = await get(serverId, id, row.groupId);
		const revision = group?.revisions.find((candidate) => candidate.id === requestedRevisionId);
		return group && revision ? { group, revision } : null;
	}

	return { list, get, getRevision };
}

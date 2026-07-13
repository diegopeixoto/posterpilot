import {
	and,
	asc,
	count,
	countDistinct,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	type SQL
} from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '$lib/server/db/schema';
import {
	appliedPosters,
	artworkRevisionGroups,
	artworkRevisions,
	artworkSlotStates,
	artworkSnapshots,
	automationOccurrences,
	automationSchedules,
	childSelections,
	collectionMemberships,
	diagnosticResults,
	diagnosticRuns,
	events,
	jobAttempts,
	jobItemOutcomes,
	jobs,
	mediaCollections,
	mediaItems,
	operationPlans,
	posterCandidates,
	providerDiscoveryOutcomes,
	providerDiscoveryRuns,
	providerStatuses,
	resolutionAudits,
	reviewEvents,
	reviewViews,
	serverInstances,
	settings
} from '$lib/server/db/schema';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type {
	CreateOperationPlanInput,
	OperationPlan,
	OperationPlanExpectations
} from '$lib/server/plans/operation-plan-store';
import { ACTIVE_SERVER_INSTANCE_KEY } from './store';

const SERVER_PURGE_PLAN_KIND = 'server_permanent_purge';
const SERVER_PURGE_PLAN_VERSION = 1 as const;

const ACTIVE_JOB_STATUSES = ['pending', 'running', 'retry_scheduled'] as const;
const MUTATING_JOB_TYPES = [
	'sync',
	'full_rescan',
	'discover',
	'apply',
	'retry',
	'automation',
	'restore',
	'collection_apply',
	'cross_server_apply'
] as const;

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

export interface ServerPurgePlanStore {
	create<T>(input: CreateOperationPlanInput<T>): Promise<OperationPlan<T>>;
	validate<T = unknown>(
		id: string,
		expectations?: OperationPlanExpectations
	): Promise<OperationPlan<T>>;
	consume<T = unknown>(
		id: string,
		expectations?: OperationPlanExpectations
	): Promise<OperationPlan<T>>;
}

export interface ServerPurgeSnapshotStore {
	release(referenceId: string, sha256: string): Promise<boolean>;
}

export interface ServerPurgeImpact {
	serverRecords: number;
	libraries: number;
	items: number;
	candidates: number;
	childSelections: number;
	applications: number;
	jobs: number;
	jobAttempts: number;
	jobItemOutcomes: number;
	events: number;
	collections: number;
	collectionMemberships: number;
	artworkSlotStates: number;
	snapshots: number;
	snapshotFiles: number;
	revisionGroups: number;
	revisions: number;
	discoveryRuns: number;
	discoveryOutcomes: number;
	providerStatuses: number;
	diagnosticRuns: number;
	diagnosticResults: number;
	reviewViews: number;
	reviewEvents: number;
	schedules: number;
	scheduleOccurrences: number;
	resolutionAudits: number;
	operationPlans: number;
	activeMutatingJobs: number;
	totalRecords: number;
}

export interface ServerPurgePlanPayload {
	type: typeof SERVER_PURGE_PLAN_KIND;
	version: typeof SERVER_PURGE_PLAN_VERSION;
	server: {
		id: string;
		name: string;
		type: 'plex' | 'jellyfin' | 'emby';
		disconnectedAt: string;
		updatedAt: string;
	};
	impact: ServerPurgeImpact;
	scopeFingerprint: string;
	sourceFingerprint: string;
}

export interface ServerPurgePreview {
	planId: string;
	digest: string;
	expiresAt: string;
	server: Omit<ServerPurgePlanPayload['server'], 'updatedAt'>;
	impact: ServerPurgeImpact;
	blocked: boolean;
	backupRecommended: true;
}

export interface ConfirmServerPurgeInput {
	serverInstanceId: string;
	planId: string;
	digest: string;
}

export interface ServerPurgeResult {
	serverInstanceId: string;
	impact: ServerPurgeImpact;
	activeServerId: string | null;
	snapshotFilesReleased: number;
	snapshotFilesReleaseFailed: number;
}

export type ServerPurgeErrorCode =
	| 'invalid_request'
	| 'server_instance_not_found'
	| 'server_purge_requires_disconnect'
	| 'server_purge_active_jobs'
	| 'server_purge_stale'
	| 'server_purge_invalid_plan'
	| 'server_purge_scope_mismatch';

class ServerPurgeError extends Error {
	constructor(readonly code: ServerPurgeErrorCode) {
		super(code);
		this.name = 'ServerPurgeError';
	}
}

export interface ServerPurgeServiceOptions {
	snapshotStore?: ServerPurgeSnapshotStore;
}

function assertId(value: string): void {
	if (!value || value.trim() !== value) throw new ServerPurgeError('invalid_request');
}

async function countRows(executor: ReadExecutor, table: SQLiteTable, where: SQL): Promise<number> {
	const [row] = await executor.select({ value: count() }).from(table).where(where);
	return Number(row?.value ?? 0);
}

function recalculateTotal(impact: ServerPurgeImpact): ServerPurgeImpact {
	const totalRecords =
		impact.serverRecords +
		impact.items +
		impact.candidates +
		impact.childSelections +
		impact.applications +
		impact.jobs +
		impact.jobAttempts +
		impact.jobItemOutcomes +
		impact.events +
		impact.collections +
		impact.collectionMemberships +
		impact.artworkSlotStates +
		impact.snapshots +
		impact.revisionGroups +
		impact.revisions +
		impact.discoveryRuns +
		impact.discoveryOutcomes +
		impact.providerStatuses +
		impact.diagnosticRuns +
		impact.diagnosticResults +
		impact.reviewViews +
		impact.reviewEvents +
		impact.schedules +
		impact.scheduleOccurrences +
		impact.resolutionAudits +
		impact.operationPlans;
	return { ...impact, totalRecords };
}

async function impactFor(
	executor: ReadExecutor,
	serverInstanceId: string
): Promise<ServerPurgeImpact> {
	const scopedJobs = executor
		.select({ id: jobs.id })
		.from(jobs)
		.where(eq(jobs.serverInstanceId, serverInstanceId));
	const scopedDiagnosticRuns = executor
		.select({ id: diagnosticRuns.id })
		.from(diagnosticRuns)
		.where(eq(diagnosticRuns.serverInstanceId, serverInstanceId));
	const scopedSchedules = executor
		.select({ id: automationSchedules.id })
		.from(automationSchedules)
		.where(eq(automationSchedules.serverInstanceId, serverInstanceId));

	const [libraryRow] = await executor
		.select({ value: countDistinct(mediaItems.sectionKey) })
		.from(mediaItems)
		.where(eq(mediaItems.serverInstanceId, serverInstanceId));
	const impact: ServerPurgeImpact = {
		serverRecords: 1,
		libraries: Number(libraryRow?.value ?? 0),
		items: await countRows(executor, mediaItems, eq(mediaItems.serverInstanceId, serverInstanceId)),
		candidates: await countRows(
			executor,
			posterCandidates,
			eq(posterCandidates.serverInstanceId, serverInstanceId)
		),
		childSelections: await countRows(
			executor,
			childSelections,
			eq(childSelections.serverInstanceId, serverInstanceId)
		),
		applications: await countRows(
			executor,
			appliedPosters,
			eq(appliedPosters.serverInstanceId, serverInstanceId)
		),
		jobs: await countRows(executor, jobs, eq(jobs.serverInstanceId, serverInstanceId)),
		jobAttempts: await countRows(
			executor,
			jobAttempts,
			or(
				eq(jobAttempts.serverInstanceId, serverInstanceId),
				inArray(jobAttempts.jobId, scopedJobs)
			)!
		),
		jobItemOutcomes: await countRows(
			executor,
			jobItemOutcomes,
			or(
				eq(jobItemOutcomes.serverInstanceId, serverInstanceId),
				inArray(jobItemOutcomes.jobId, scopedJobs)
			)!
		),
		events: await countRows(executor, events, eq(events.serverInstanceId, serverInstanceId)),
		collections: await countRows(
			executor,
			mediaCollections,
			eq(mediaCollections.serverInstanceId, serverInstanceId)
		),
		collectionMemberships: await countRows(
			executor,
			collectionMemberships,
			eq(collectionMemberships.serverInstanceId, serverInstanceId)
		),
		artworkSlotStates: await countRows(
			executor,
			artworkSlotStates,
			eq(artworkSlotStates.serverInstanceId, serverInstanceId)
		),
		snapshots: await countRows(
			executor,
			artworkSnapshots,
			eq(artworkSnapshots.serverInstanceId, serverInstanceId)
		),
		snapshotFiles: await countRows(
			executor,
			artworkSnapshots,
			and(
				eq(artworkSnapshots.serverInstanceId, serverInstanceId),
				isNotNull(artworkSnapshots.sha256)
			)!
		),
		revisionGroups: await countRows(
			executor,
			artworkRevisionGroups,
			eq(artworkRevisionGroups.serverInstanceId, serverInstanceId)
		),
		revisions: await countRows(
			executor,
			artworkRevisions,
			eq(artworkRevisions.serverInstanceId, serverInstanceId)
		),
		discoveryRuns: await countRows(
			executor,
			providerDiscoveryRuns,
			eq(providerDiscoveryRuns.serverInstanceId, serverInstanceId)
		),
		discoveryOutcomes: await countRows(
			executor,
			providerDiscoveryOutcomes,
			eq(providerDiscoveryOutcomes.serverInstanceId, serverInstanceId)
		),
		providerStatuses: await countRows(
			executor,
			providerStatuses,
			eq(providerStatuses.serverInstanceId, serverInstanceId)
		),
		diagnosticRuns: await countRows(
			executor,
			diagnosticRuns,
			eq(diagnosticRuns.serverInstanceId, serverInstanceId)
		),
		diagnosticResults: await countRows(
			executor,
			diagnosticResults,
			or(
				eq(diagnosticResults.serverInstanceId, serverInstanceId),
				inArray(diagnosticResults.runId, scopedDiagnosticRuns)
			)!
		),
		reviewViews: await countRows(
			executor,
			reviewViews,
			eq(reviewViews.serverInstanceId, serverInstanceId)
		),
		reviewEvents: await countRows(
			executor,
			reviewEvents,
			eq(reviewEvents.serverInstanceId, serverInstanceId)
		),
		schedules: await countRows(
			executor,
			automationSchedules,
			eq(automationSchedules.serverInstanceId, serverInstanceId)
		),
		scheduleOccurrences: await countRows(
			executor,
			automationOccurrences,
			or(
				eq(automationOccurrences.serverInstanceId, serverInstanceId),
				inArray(automationOccurrences.scheduleId, scopedSchedules)
			)!
		),
		resolutionAudits: await countRows(
			executor,
			resolutionAudits,
			eq(resolutionAudits.serverInstanceId, serverInstanceId)
		),
		operationPlans: await countRows(
			executor,
			operationPlans,
			eq(operationPlans.serverInstanceId, serverInstanceId)
		),
		activeMutatingJobs: await countRows(
			executor,
			jobs,
			and(
				eq(jobs.serverInstanceId, serverInstanceId),
				inArray(jobs.status, ACTIVE_JOB_STATUSES),
				inArray(jobs.type, MUTATING_JOB_TYPES)
			)!
		),
		totalRecords: 0
	};
	return recalculateTotal(impact);
}

function sortedIds(rows: Array<{ id: string | number }>): string[] {
	return rows.map((row) => String(row.id)).sort((left, right) => left.localeCompare(right));
}

/** Exact identity of every row the purge transaction will delete, excluding purge plans themselves. */
async function scopeFingerprintFor(
	executor: ReadExecutor,
	serverInstanceId: string
): Promise<string> {
	const scopedJobs = executor
		.select({ id: jobs.id })
		.from(jobs)
		.where(eq(jobs.serverInstanceId, serverInstanceId));
	const scopedDiagnosticRuns = executor
		.select({ id: diagnosticRuns.id })
		.from(diagnosticRuns)
		.where(eq(diagnosticRuns.serverInstanceId, serverInstanceId));
	const scopedSchedules = executor
		.select({ id: automationSchedules.id })
		.from(automationSchedules)
		.where(eq(automationSchedules.serverInstanceId, serverInstanceId));
	const identity = {
		libraries: (
			await executor
				.select({ id: mediaItems.sectionKey })
				.from(mediaItems)
				.where(eq(mediaItems.serverInstanceId, serverInstanceId))
				.groupBy(mediaItems.sectionKey)
		)
			.map((row) => row.id)
			.sort(),
		items: sortedIds(
			await executor
				.select({ id: mediaItems.id })
				.from(mediaItems)
				.where(eq(mediaItems.serverInstanceId, serverInstanceId))
		),
		candidates: sortedIds(
			await executor
				.select({ id: posterCandidates.id })
				.from(posterCandidates)
				.where(eq(posterCandidates.serverInstanceId, serverInstanceId))
		),
		childSelections: sortedIds(
			await executor
				.select({ id: childSelections.id })
				.from(childSelections)
				.where(eq(childSelections.serverInstanceId, serverInstanceId))
		),
		applications: sortedIds(
			await executor
				.select({ id: appliedPosters.id })
				.from(appliedPosters)
				.where(eq(appliedPosters.serverInstanceId, serverInstanceId))
		),
		jobs: sortedIds(
			await executor
				.select({ id: jobs.id })
				.from(jobs)
				.where(eq(jobs.serverInstanceId, serverInstanceId))
		),
		jobAttempts: sortedIds(
			await executor
				.select({ id: jobAttempts.id })
				.from(jobAttempts)
				.where(
					or(
						eq(jobAttempts.serverInstanceId, serverInstanceId),
						inArray(jobAttempts.jobId, scopedJobs)
					)
				)
		),
		jobItemOutcomes: sortedIds(
			await executor
				.select({ id: jobItemOutcomes.id })
				.from(jobItemOutcomes)
				.where(
					or(
						eq(jobItemOutcomes.serverInstanceId, serverInstanceId),
						inArray(jobItemOutcomes.jobId, scopedJobs)
					)
				)
		),
		events: sortedIds(
			await executor
				.select({ id: events.id })
				.from(events)
				.where(eq(events.serverInstanceId, serverInstanceId))
		),
		collections: sortedIds(
			await executor
				.select({ id: mediaCollections.id })
				.from(mediaCollections)
				.where(eq(mediaCollections.serverInstanceId, serverInstanceId))
		),
		collectionMemberships: sortedIds(
			await executor
				.select({ id: collectionMemberships.id })
				.from(collectionMemberships)
				.where(eq(collectionMemberships.serverInstanceId, serverInstanceId))
		),
		artworkSlotStates: sortedIds(
			await executor
				.select({ id: artworkSlotStates.id })
				.from(artworkSlotStates)
				.where(eq(artworkSlotStates.serverInstanceId, serverInstanceId))
		),
		snapshots: sortedIds(
			await executor
				.select({ id: artworkSnapshots.id })
				.from(artworkSnapshots)
				.where(eq(artworkSnapshots.serverInstanceId, serverInstanceId))
		),
		revisionGroups: sortedIds(
			await executor
				.select({ id: artworkRevisionGroups.id })
				.from(artworkRevisionGroups)
				.where(eq(artworkRevisionGroups.serverInstanceId, serverInstanceId))
		),
		revisions: sortedIds(
			await executor
				.select({ id: artworkRevisions.id })
				.from(artworkRevisions)
				.where(eq(artworkRevisions.serverInstanceId, serverInstanceId))
		),
		discoveryRuns: sortedIds(
			await executor
				.select({ id: providerDiscoveryRuns.id })
				.from(providerDiscoveryRuns)
				.where(eq(providerDiscoveryRuns.serverInstanceId, serverInstanceId))
		),
		discoveryOutcomes: sortedIds(
			await executor
				.select({ id: providerDiscoveryOutcomes.id })
				.from(providerDiscoveryOutcomes)
				.where(eq(providerDiscoveryOutcomes.serverInstanceId, serverInstanceId))
		),
		providerStatuses: sortedIds(
			await executor
				.select({ id: providerStatuses.id })
				.from(providerStatuses)
				.where(eq(providerStatuses.serverInstanceId, serverInstanceId))
		),
		diagnosticRuns: sortedIds(
			await executor
				.select({ id: diagnosticRuns.id })
				.from(diagnosticRuns)
				.where(eq(diagnosticRuns.serverInstanceId, serverInstanceId))
		),
		diagnosticResults: sortedIds(
			await executor
				.select({ id: diagnosticResults.id })
				.from(diagnosticResults)
				.where(
					or(
						eq(diagnosticResults.serverInstanceId, serverInstanceId),
						inArray(diagnosticResults.runId, scopedDiagnosticRuns)
					)
				)
		),
		reviewViews: sortedIds(
			await executor
				.select({ id: reviewViews.id })
				.from(reviewViews)
				.where(eq(reviewViews.serverInstanceId, serverInstanceId))
		),
		reviewEvents: sortedIds(
			await executor
				.select({ id: reviewEvents.id })
				.from(reviewEvents)
				.where(eq(reviewEvents.serverInstanceId, serverInstanceId))
		),
		schedules: sortedIds(
			await executor
				.select({ id: automationSchedules.id })
				.from(automationSchedules)
				.where(eq(automationSchedules.serverInstanceId, serverInstanceId))
		),
		scheduleOccurrences: sortedIds(
			await executor
				.select({ id: automationOccurrences.id })
				.from(automationOccurrences)
				.where(
					or(
						eq(automationOccurrences.serverInstanceId, serverInstanceId),
						inArray(automationOccurrences.scheduleId, scopedSchedules)
					)
				)
		),
		resolutionAudits: sortedIds(
			await executor
				.select({ id: resolutionAudits.id })
				.from(resolutionAudits)
				.where(eq(resolutionAudits.serverInstanceId, serverInstanceId))
		),
		operationPlans: sortedIds(
			await executor
				.select({ id: operationPlans.id })
				.from(operationPlans)
				.where(
					and(
						eq(operationPlans.serverInstanceId, serverInstanceId),
						ne(operationPlans.kind, SERVER_PURGE_PLAN_KIND)
					)
				)
		)
	};
	return hashCanonicalJson(identity);
}

async function serverState(executor: ReadExecutor, serverInstanceId: string) {
	const [server] = await executor
		.select({
			id: serverInstances.id,
			name: serverInstances.name,
			type: serverInstances.type,
			disconnectedAt: serverInstances.disconnectedAt,
			updatedAt: serverInstances.updatedAt
		})
		.from(serverInstances)
		.where(eq(serverInstances.id, serverInstanceId))
		.limit(1);
	if (!server) throw new ServerPurgeError('server_instance_not_found');
	if (!server.disconnectedAt) throw new ServerPurgeError('server_purge_requires_disconnect');
	return {
		id: server.id,
		name: server.name,
		type: server.type,
		disconnectedAt: server.disconnectedAt.toISOString(),
		updatedAt: server.updatedAt.toISOString()
	};
}

function sourceFingerprint(
	server: ServerPurgePlanPayload['server'],
	impact: ServerPurgeImpact,
	scopeFingerprint: string
): string {
	return hashCanonicalJson({ server, impact, scopeFingerprint });
}

function isImpact(value: unknown): value is ServerPurgeImpact {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return Object.values(record).every((entry) => Number.isSafeInteger(entry) && Number(entry) >= 0);
}

function assertServerPurgePlanPayload(payload: unknown): asserts payload is ServerPurgePlanPayload {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new ServerPurgeError('server_purge_invalid_plan');
	}
	const candidate = payload as Partial<ServerPurgePlanPayload>;
	if (
		candidate.type !== SERVER_PURGE_PLAN_KIND ||
		candidate.version !== SERVER_PURGE_PLAN_VERSION ||
		!candidate.server ||
		!candidate.server.id ||
		!candidate.server.name ||
		!['plex', 'jellyfin', 'emby'].includes(candidate.server.type ?? '') ||
		!candidate.server.disconnectedAt ||
		!Number.isFinite(Date.parse(candidate.server.disconnectedAt)) ||
		!candidate.server.updatedAt ||
		!Number.isFinite(Date.parse(candidate.server.updatedAt)) ||
		!isImpact(candidate.impact) ||
		typeof candidate.scopeFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/.test(candidate.scopeFingerprint) ||
		typeof candidate.sourceFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/.test(candidate.sourceFingerprint) ||
		sourceFingerprint(
			candidate.server as ServerPurgePlanPayload['server'],
			candidate.impact as ServerPurgeImpact,
			candidate.scopeFingerprint
		) !== candidate.sourceFingerprint
	) {
		throw new ServerPurgeError('server_purge_invalid_plan');
	}
}

async function activeServerId(executor: ReadExecutor): Promise<string | null> {
	const [setting] = await executor
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY))
		.limit(1);
	if (setting?.value) {
		const [active] = await executor
			.select({ id: serverInstances.id })
			.from(serverInstances)
			.where(
				and(
					eq(serverInstances.id, setting.value),
					eq(serverInstances.enabled, true),
					isNull(serverInstances.disconnectedAt)
				)
			)
			.limit(1);
		if (active) return active.id;
	}
	const [fallback] = await executor
		.select({ id: serverInstances.id })
		.from(serverInstances)
		.where(and(eq(serverInstances.enabled, true), isNull(serverInstances.disconnectedAt)))
		.orderBy(asc(serverInstances.createdAt), asc(serverInstances.name))
		.limit(1);
	return fallback?.id ?? null;
}

export function createServerPurgeService(
	database: Database,
	planStore: ServerPurgePlanStore,
	options: ServerPurgeServiceOptions = {}
) {
	async function preview(serverInstanceId: string): Promise<ServerPurgePreview> {
		assertId(serverInstanceId);
		const server = await serverState(database, serverInstanceId);
		const currentImpact = await impactFor(database, serverInstanceId);
		const scopeFingerprint = await scopeFingerprintFor(database, serverInstanceId);
		const impact = recalculateTotal({
			...currentImpact,
			// The newly created purge plan is itself scoped data removed by confirmation.
			operationPlans: currentImpact.operationPlans + 1
		});
		const payload: ServerPurgePlanPayload = {
			type: SERVER_PURGE_PLAN_KIND,
			version: SERVER_PURGE_PLAN_VERSION,
			server,
			impact,
			scopeFingerprint,
			sourceFingerprint: sourceFingerprint(server, impact, scopeFingerprint)
		};
		const plan = await planStore.create({
			kind: SERVER_PURGE_PLAN_KIND,
			serverInstanceId,
			payload
		});
		return {
			planId: plan.id,
			digest: plan.digest,
			expiresAt: plan.expiresAt.toISOString(),
			server: {
				id: server.id,
				name: server.name,
				type: server.type,
				disconnectedAt: server.disconnectedAt
			},
			impact,
			blocked: impact.activeMutatingJobs > 0,
			backupRecommended: true
		};
	}

	async function validateFresh(
		executor: ReadExecutor,
		serverInstanceId: string,
		payload: ServerPurgePlanPayload
	): Promise<ServerPurgeImpact> {
		const server = await serverState(executor, serverInstanceId);
		const impact = await impactFor(executor, serverInstanceId);
		const scopeFingerprint = await scopeFingerprintFor(executor, serverInstanceId);
		if (impact.activeMutatingJobs > 0) {
			throw new ServerPurgeError('server_purge_active_jobs');
		}
		if (
			payload.server.id !== serverInstanceId ||
			payload.scopeFingerprint !== scopeFingerprint ||
			payload.sourceFingerprint !== sourceFingerprint(server, impact, scopeFingerprint)
		) {
			throw new ServerPurgeError('server_purge_stale');
		}
		return impact;
	}

	async function confirm(input: ConfirmServerPurgeInput): Promise<ServerPurgeResult> {
		assertId(input.serverInstanceId);
		assertId(input.planId);
		if (!/^[a-f0-9]{64}$/.test(input.digest)) {
			throw new ServerPurgeError('invalid_request');
		}
		const expectations: OperationPlanExpectations = {
			kind: SERVER_PURGE_PLAN_KIND,
			digest: input.digest,
			serverInstanceId: input.serverInstanceId
		};
		const pending = await planStore.validate<unknown>(input.planId, expectations);
		assertServerPurgePlanPayload(pending.payload);
		const payload = pending.payload;
		if (payload.server.id !== input.serverInstanceId) {
			throw new ServerPurgeError('server_purge_scope_mismatch');
		}
		await validateFresh(database, input.serverInstanceId, payload);
		await planStore.consume(input.planId, { ...expectations, payload });

		const committed = await database.transaction(async (tx) => {
			const impact = await validateFresh(tx, input.serverInstanceId, payload);
			const snapshotReferences = await tx
				.select({ id: artworkSnapshots.id, sha256: artworkSnapshots.sha256 })
				.from(artworkSnapshots)
				.where(
					and(
						eq(artworkSnapshots.serverInstanceId, input.serverInstanceId),
						isNotNull(artworkSnapshots.sha256)
					)
				);
			const scopedJobIds = tx
				.select({ id: jobs.id })
				.from(jobs)
				.where(eq(jobs.serverInstanceId, input.serverInstanceId));
			const scopedDiagnosticRunIds = tx
				.select({ id: diagnosticRuns.id })
				.from(diagnosticRuns)
				.where(eq(diagnosticRuns.serverInstanceId, input.serverInstanceId));
			const scopedScheduleIds = tx
				.select({ id: automationSchedules.id })
				.from(automationSchedules)
				.where(eq(automationSchedules.serverInstanceId, input.serverInstanceId));

			await tx
				.delete(automationOccurrences)
				.where(
					or(
						eq(automationOccurrences.serverInstanceId, input.serverInstanceId),
						inArray(automationOccurrences.scheduleId, scopedScheduleIds)
					)
				);
			await tx
				.delete(automationSchedules)
				.where(eq(automationSchedules.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(diagnosticResults)
				.where(
					or(
						eq(diagnosticResults.serverInstanceId, input.serverInstanceId),
						inArray(diagnosticResults.runId, scopedDiagnosticRunIds)
					)
				);
			await tx
				.delete(diagnosticRuns)
				.where(eq(diagnosticRuns.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(providerDiscoveryOutcomes)
				.where(eq(providerDiscoveryOutcomes.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(providerDiscoveryRuns)
				.where(eq(providerDiscoveryRuns.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(reviewEvents)
				.where(eq(reviewEvents.serverInstanceId, input.serverInstanceId));
			await tx.delete(reviewViews).where(eq(reviewViews.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(resolutionAudits)
				.where(eq(resolutionAudits.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(collectionMemberships)
				.where(eq(collectionMemberships.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(jobItemOutcomes)
				.where(
					or(
						eq(jobItemOutcomes.serverInstanceId, input.serverInstanceId),
						inArray(jobItemOutcomes.jobId, scopedJobIds)
					)
				);
			await tx
				.delete(jobAttempts)
				.where(
					or(
						eq(jobAttempts.serverInstanceId, input.serverInstanceId),
						inArray(jobAttempts.jobId, scopedJobIds)
					)
				);
			await tx.delete(events).where(eq(events.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(appliedPosters)
				.where(eq(appliedPosters.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(childSelections)
				.where(eq(childSelections.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(artworkRevisions)
				.where(eq(artworkRevisions.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(artworkRevisionGroups)
				.where(eq(artworkRevisionGroups.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(artworkSlotStates)
				.where(eq(artworkSlotStates.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(artworkSnapshots)
				.where(eq(artworkSnapshots.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(posterCandidates)
				.where(eq(posterCandidates.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(mediaCollections)
				.where(eq(mediaCollections.serverInstanceId, input.serverInstanceId));
			await tx.delete(jobs).where(eq(jobs.serverInstanceId, input.serverInstanceId));
			await tx.delete(mediaItems).where(eq(mediaItems.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(providerStatuses)
				.where(eq(providerStatuses.serverInstanceId, input.serverInstanceId));
			await tx
				.delete(operationPlans)
				.where(eq(operationPlans.serverInstanceId, input.serverInstanceId));
			const deleted = await tx
				.delete(serverInstances)
				.where(eq(serverInstances.id, input.serverInstanceId))
				.returning({ id: serverInstances.id });
			if (deleted.length !== 1) throw new ServerPurgeError('server_instance_not_found');

			await tx
				.delete(settings)
				.where(
					and(
						eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY),
						eq(settings.value, input.serverInstanceId)
					)
				);
			const nextActiveServerId = await activeServerId(tx);
			if (nextActiveServerId) {
				await tx
					.insert(settings)
					.values({ key: ACTIVE_SERVER_INSTANCE_KEY, value: nextActiveServerId })
					.onConflictDoUpdate({
						target: settings.key,
						set: { value: nextActiveServerId }
					});
			} else {
				await tx.delete(settings).where(eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY));
			}
			await tx.insert(events).values({
				serverInstanceId: null,
				jobId: null,
				mediaItemId: null,
				level: 'info',
				type: 'system',
				code: 'server_purged',
				parameters: {
					serverInstanceId: input.serverInstanceId,
					totalRecords: impact.totalRecords
				},
				message: 'Server instance permanently purged',
				context: null
			});
			return { impact, snapshotReferences, activeServerId: nextActiveServerId };
		});

		let snapshotFilesReleased = 0;
		let snapshotFilesReleaseFailed = 0;
		for (const snapshot of committed.snapshotReferences) {
			if (!snapshot.sha256 || !options.snapshotStore) continue;
			try {
				if (await options.snapshotStore.release(snapshot.id, snapshot.sha256)) {
					snapshotFilesReleased += 1;
				} else snapshotFilesReleaseFailed += 1;
			} catch {
				snapshotFilesReleaseFailed += 1;
			}
		}
		return {
			serverInstanceId: input.serverInstanceId,
			impact: committed.impact,
			activeServerId: committed.activeServerId,
			snapshotFilesReleased,
			snapshotFilesReleaseFailed
		};
	}

	return { preview, confirm };
}

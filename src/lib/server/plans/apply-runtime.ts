import { inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { createArtworkApplyCoordinator } from '$lib/server/artwork-revisions/apply-coordinator';
import { createArtworkRevisionLedger } from '$lib/server/artwork-revisions/ledger';
import {
	ArtworkSnapshotStore,
	resolveArtworkSnapshotDirectory
} from '$lib/server/artwork-revisions/snapshot-store';
import { createArtworkSnapshotRepository } from '$lib/server/artwork-revisions/snapshots';
import { db } from '$lib/server/db';
import { assertCollectionApplyContextFresh } from '$lib/server/collections/apply-scope';
import { appliedPosters, mediaItems } from '$lib/server/db/schema';
import { resolveDataPaths } from '$lib/server/data-paths';
import { resolveConfig } from '$lib/server/config';
import { writeKometaYaml } from '$lib/server/kometa/yaml';
import { getActiveServerInstance } from '$lib/server/server-instances';
import {
	exactApplyPreviewResponse,
	confirmApplyPlan,
	type ConfirmApplyPlanRequest
} from './apply-api';
import { createApplyDestinationResolver, kometaOutputDirectory } from './apply-destinations';
import {
	executeFrozenApplyPlan,
	type ApplyOperationExecutionResult,
	type ApplyPlanExecutionHooks
} from './apply-executor';
import { type ApplyPlanOperation, type FrozenApplyJobPayload } from './apply-plan';
import { assertApplyPlanFresh } from './apply-plan-validation';
import { createDatabaseApplyPlanner, loadDatabaseApplyPlannerItemData } from './apply-planner-db';
import {
	ApplyPlannerError,
	type ApplyItemRef,
	type PlanArtworkApplyRequest
} from './apply-planner';
import {
	createDatabaseApplyServerRegistry,
	type ApplyServerBinding,
	type ApplyServerRegistry
} from './apply-server-registry';
import { operationPlanStore } from './operation-plan-store';

const databaseServerRegistry = createDatabaseApplyServerRegistry();
const databaseDestinationResolver = createApplyDestinationResolver({
	serverRegistry: databaseServerRegistry
});
const databaseApplyPlanner = createDatabaseApplyPlanner({
	resolveDestinationSlots: databaseDestinationResolver
});

/** Resolve the active named server used as the mutation authorization scope. */
export async function activeApplyServerInstanceId(): Promise<string> {
	const active = await getActiveServerInstance();
	if (!active) throw new ApplyPlannerError('scope_mismatch', 'No active server instance');
	return active.id;
}

/** Materialize ids into explicit scoped planner refs without silently dropping rows. */
export async function resolveDatabaseApplyTargets(
	itemIds: number[],
	expectedServerInstanceId: string
): Promise<ApplyItemRef[]> {
	if (
		itemIds.length === 0 ||
		itemIds.some((id) => !Number.isInteger(id) || id <= 0) ||
		new Set(itemIds).size !== itemIds.length
	) {
		throw new ApplyPlannerError(
			'invalid_request',
			'Apply item ids must be unique positive integers'
		);
	}
	const rows = await db
		.select({ id: mediaItems.id, serverInstanceId: mediaItems.serverInstanceId })
		.from(mediaItems)
		.where(inArray(mediaItems.id, itemIds));
	const byId = new Map(rows.map((row) => [row.id, row]));
	return itemIds.map((id) => {
		const row = byId.get(id);
		if (!row || row.serverInstanceId !== expectedServerInstanceId) {
			throw new ApplyPlannerError('scope_mismatch', 'Apply item does not belong to active scope');
		}
		return { serverInstanceId: row.serverInstanceId, mediaItemId: row.id };
	});
}

export async function previewDatabaseArtworkApply(request: PlanArtworkApplyRequest) {
	return exactApplyPreviewResponse(await databaseApplyPlanner(request));
}

export async function confirmDatabaseArtworkApply(
	request: ConfirmApplyPlanRequest,
	enqueue: (payload: FrozenApplyJobPayload) => Promise<number>,
	options: {
		validateContext?: (payload: import('./apply-plan').ApplyPlanPayloadV1) => Promise<void>;
	} = {}
) {
	return confirmApplyPlan(request, {
		store: operationPlanStore,
		loadItemData: loadDatabaseApplyPlannerItemData,
		resolveDestinationSlots: databaseDestinationResolver,
		validateContext: options.validateContext,
		enqueue
	});
}

function cachedRegistry(registry: ApplyServerRegistry): ApplyServerRegistry {
	const cache = new Map<string, Promise<ApplyServerBinding>>();
	return {
		resolve(serverInstanceId) {
			let pending = cache.get(serverInstanceId);
			if (!pending) {
				pending = registry.resolve(serverInstanceId);
				cache.set(serverInstanceId, pending);
			}
			return pending;
		}
	};
}

async function recordLegacyOutcome(
	operation: ApplyPlanOperation,
	result: ApplyOperationExecutionResult
): Promise<void> {
	await db.insert(appliedPosters).values({
		serverInstanceId: operation.target.serverInstanceId,
		mediaItemId: operation.target.mediaItemId,
		candidateId: operation.selection.candidateId,
		url: operation.selection.url,
		method: operation.destination === 'server' ? 'server' : 'kometa',
		destination: operation.destination,
		status: result.status,
		sourceProvider: operation.selection.provider,
		error: result.error ?? null,
		kind: operation.slot.kind,
		season: operation.slot.season,
		episode: operation.slot.episode
	});
}

/** Job adapter: validate once more at execution, then consume no mutable selection state. */
export async function executeDatabaseFrozenApplyJob(
	payload: FrozenApplyJobPayload,
	hooks: ApplyPlanExecutionHooks = {},
	context: { jobId?: number | null } = {}
) {
	const config = await resolveConfig();
	const registry = cachedRegistry(databaseServerRegistry);
	const kometaServerIds = new Set(
		payload.plan.items
			.filter((item) => item.operations.some((operation) => operation.destination === 'kometa'))
			.map((item) => item.target.serverInstanceId)
	);
	if (
		kometaServerIds.size > 0 &&
		(kometaServerIds.size !== 1 ||
			!config.kometaServerInstanceId ||
			!kometaServerIds.has(config.kometaServerInstanceId))
	) {
		throw new ApplyPlannerError(
			'scope_mismatch',
			'Frozen Kometa operations do not match the configured Plex server binding'
		);
	}
	for (const serverInstanceId of kometaServerIds) {
		const binding = await registry.resolve(serverInstanceId);
		if (binding.server.type !== 'plex') {
			throw new ApplyPlannerError('scope_mismatch', 'Kometa operations require a Plex server');
		}
	}
	const resolveDestinationSlots = createApplyDestinationResolver({
		serverRegistry: registry,
		loadConfig: () => Promise.resolve(config)
	});
	await assertApplyPlanFresh(payload.plan, {
		loadItemData: loadDatabaseApplyPlannerItemData,
		resolveDestinationSlots,
		validateContext:
			payload.plan.context.source === 'collection'
				? (plan) => assertCollectionApplyContextFresh(db, plan)
				: undefined
	});
	const snapshotStore = new ArtworkSnapshotStore(
		resolveArtworkSnapshotDirectory(resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE))
	);
	const coordinator = createArtworkApplyCoordinator({
		snapshots: createArtworkSnapshotRepository(db, snapshotStore),
		ledger: createArtworkRevisionLedger(db),
		planId: payload.planId,
		jobId: context.jobId ?? null,
		collectionHistory:
			payload.plan.context.source === 'collection'
				? {
						collectionId: payload.plan.context.collectionId,
						targetItemIds: payload.plan.scope.targetItemIds
					}
				: undefined,
		kometaAssetsDirectory: kometaOutputDirectory(config)
	});
	const result = await executeFrozenApplyPlan(
		payload.planId,
		payload.digest,
		payload.plan,
		{
			serverRegistry: registry,
			writeKometa: (items, operations = []) =>
				writeKometaYaml(kometaOutputDirectory(config), items, {
					validateCurrent: (raw) => coordinator.assertKometaFresh(operations, raw)
				}),
			prepareOperation: coordinator.prepareOperation,
			recordOutcome: async (operation, operationResult, operationContext) => {
				const recorded = await coordinator.recordOutcome(
					operation,
					operationResult,
					operationContext
				);
				// Keep the compatibility projection while the item UI migrates fully to
				// the immutable revision timeline. It is never the source for undo.
				await recordLegacyOutcome(operation, recorded).catch(() => undefined);
				return recorded;
			}
		},
		hooks
	);
	await coordinator.finalize(result);
	return result;
}

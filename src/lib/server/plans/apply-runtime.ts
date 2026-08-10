import { env } from '$env/dynamic/private';
import { join } from 'node:path';
import { createArtworkApplyCoordinator } from '$lib/server/artwork-revisions/apply-coordinator';
import { createArtworkRevisionLedger } from '$lib/server/artwork-revisions/ledger';
import {
	ArtworkSnapshotStore,
	resolveArtworkSnapshotDirectory
} from '$lib/server/artwork-revisions/snapshot-store';
import { createArtworkSnapshotRepository } from '$lib/server/artwork-revisions/snapshots';
import { db } from '$lib/server/db';
import { refreshCoverageAfter } from '$lib/server/coverage/refresh';
import { assertCollectionApplyContextFresh } from '$lib/server/collections/apply-scope';
import { appliedPosters } from '$lib/server/db/schema';
import { resolveDataPaths } from '$lib/server/data-paths';
import { resolveConfig, type AppConfig } from '$lib/server/config';
import { withConfigLocks } from '$lib/server/kometa/config-io';
import { LEGACY_FILENAME } from '$lib/server/kometa/destination';
import { withKometaMigrationControlLock } from '$lib/server/kometa/migration-control-lock';
import { assertNoPendingKometaConfigMutationWhileOwned } from '$lib/server/kometa/config-mutation-recovery';
import { loadKometaMigrationJournalForGuard } from '$lib/server/kometa/migration-store';
import { kometaMigrationCollisionState } from '$lib/server/kometa/migration-state';
import { writeKometaYaml } from '$lib/server/kometa/yaml';
import { getActiveServerInstance } from '$lib/server/server-instances';
import {
	exactApplyPreviewResponse,
	confirmApplyPlan,
	type ConfirmApplyPlanRequest
} from './apply-api';
import {
	createApplyDestinationResolver,
	inspectKometaCollisionGuard,
	kometaOutputDirectory
} from './apply-destinations';
import {
	executeFrozenApplyPlan,
	type ApplyOperationExecutionResult,
	type ApplyPlanExecutionHooks,
	type ApplyPlanExecutionResult
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
import { resolveScopedApplyTargets } from './apply-targets';

const databaseServerRegistry = createDatabaseApplyServerRegistry();
function requestDestinationResolver(serverRegistry: ApplyServerRegistry = databaseServerRegistry) {
	return createApplyDestinationResolver({
		serverRegistry,
		cacheKometaReads: true,
		loadMigrationState: async (serverInstanceId) =>
			kometaMigrationCollisionState(await loadKometaMigrationJournalForGuard(serverInstanceId))
	});
}

/** Hold every in-process collision-guard source stable through one typed-file commit. */
async function withKometaGuardLocks<T>(
	config: AppConfig,
	metadataFilenames: readonly string[],
	operation: () => Promise<T>
): Promise<T> {
	const outputDirectory = kometaOutputDirectory(config);
	const paths = [
		...(config.kometaConfigPath ? [config.kometaConfigPath] : []),
		join(outputDirectory, LEGACY_FILENAME),
		...metadataFilenames.map((filename) => join(outputDirectory, filename))
	];
	return withConfigLocks(paths, operation);
}

/** Resolve the active named server used as the mutation authorization scope. */
export async function activeApplyServerInstanceId(): Promise<string> {
	const active = await getActiveServerInstance();
	if (!active) throw new ApplyPlannerError('scope_mismatch', 'No active server instance');
	return active.id;
}

export async function resolveDatabaseApplyTargets(
	itemIds: number[],
	expectedServerInstanceId: string
): Promise<ApplyItemRef[]> {
	return resolveScopedApplyTargets(db, itemIds, expectedServerInstanceId);
}

export async function previewDatabaseArtworkApply(request: PlanArtworkApplyRequest) {
	const planner = createDatabaseApplyPlanner({
		resolveDestinationSlots: requestDestinationResolver()
	});
	return exactApplyPreviewResponse(await planner(request));
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
		resolveDestinationSlots: requestDestinationResolver(),
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
		loadConfig: () => Promise.resolve(config),
		cacheKometaReads: true,
		loadMigrationState: async (serverInstanceId) =>
			kometaMigrationCollisionState(await loadKometaMigrationJournalForGuard(serverInstanceId))
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
	const preflightKometa = (operations: readonly ApplyPlanOperation[]) => {
		const filenames = new Set<string>();
		for (const operation of operations) {
			const filename = operation.kometaDestination?.filename;
			if (!filename) throw new TypeError('Kometa preflight operation is missing its typed file');
			filenames.add(filename);
		}
		return withKometaGuardLocks(config, [...filenames], () =>
			withKometaMigrationControlLock(async (assertControlLockOwned) => {
				try {
					await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
				} catch {
					throw new ApplyPlannerError(
						'invalid_destination_snapshot',
						'A confirmed Kometa configuration save requires recovery'
					);
				}
				const liveConfig = await resolveConfig();
				if (
					liveConfig.kometaServerInstanceId !== config.kometaServerInstanceId ||
					liveConfig.kometaConfigPath !== config.kometaConfigPath ||
					liveConfig.kometaMetadataPathPrefix !== config.kometaMetadataPathPrefix ||
					kometaOutputDirectory(liveConfig) !== kometaOutputDirectory(config)
				) {
					throw new ApplyPlannerError(
						'invalid_destination_snapshot',
						'Frozen Kometa configuration changed before execution'
					);
				}
				const liveResolver = createApplyDestinationResolver({
					serverRegistry: registry,
					loadConfig: () => Promise.resolve(liveConfig),
					cacheKometaReads: true,
					loadMigrationState: async (serverInstanceId) =>
						kometaMigrationCollisionState(
							await loadKometaMigrationJournalForGuard(serverInstanceId)
						)
				});
				await assertApplyPlanFresh(payload.plan, {
					loadItemData: loadDatabaseApplyPlannerItemData,
					resolveDestinationSlots: liveResolver,
					validateContext:
						payload.plan.context.source === 'collection'
							? (plan) => assertCollectionApplyContextFresh(db, plan)
							: undefined
				});
				await assertControlLockOwned();
			})
		);
	};
	const result = await executeFrozenApplyPlan(
		payload.planId,
		payload.digest,
		payload.plan,
		{
			serverRegistry: registry,
			preflightKometa,
			withKometaCommit: (operations, commit) => {
				const filenames = new Set<string>();
				for (const operation of operations) {
					const filename = operation.kometaDestination?.filename;
					if (!filename) throw new TypeError('Kometa commit operation is missing its typed file');
					filenames.add(filename);
				}
				if (filenames.size !== 1) {
					throw new TypeError('One Kometa commit batch must target exactly one file');
				}
				return withKometaGuardLocks(config, [...filenames], () =>
					withKometaMigrationControlLock(async (assertControlLockOwned) => {
						try {
							await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
						} catch {
							throw new ApplyPlannerError(
								'invalid_destination_snapshot',
								'A confirmed Kometa configuration save requires recovery'
							);
						}
						return commit(async () => {
							await assertControlLockOwned();
						});
					})
				);
			},
			writeKometa: (items, operations = [], isCancelled, assertCommitOwned) => {
				const filenames = new Set(items.map((item) => item.destination.filename));
				const operationFilenames = new Set(
					operations.map((operation) => operation.kometaDestination?.filename)
				);
				if (
					filenames.size !== 1 ||
					operationFilenames.size !== 1 ||
					![...operationFilenames].every((filename) => filenames.has(filename!))
				) {
					throw new TypeError('One Kometa writer batch must target exactly one file');
				}
				return writeKometaYaml(kometaOutputDirectory(config), items, {
					isCancelled,
					assertCommitOwned,
					validateCurrent: async (raw) => {
						// Re-resolve mutable settings while every config path and the
						// cross-process migration fence are held. Lease ownership is the
						// final await before the writer's synchronous merge/rename I/O.
						const [liveConfig, liveMigration] = await Promise.all([
							resolveConfig(),
							config.kometaServerInstanceId
								? loadKometaMigrationJournalForGuard(config.kometaServerInstanceId)
								: Promise.resolve(null)
						]);
						if (
							liveConfig.kometaServerInstanceId !== config.kometaServerInstanceId ||
							liveConfig.kometaConfigPath !== config.kometaConfigPath ||
							liveConfig.kometaMetadataPathPrefix !== config.kometaMetadataPathPrefix ||
							kometaOutputDirectory(liveConfig) !== kometaOutputDirectory(config)
						) {
							throw new Error('Frozen Kometa configuration changed before the artwork write');
						}
						coordinator.assertKometaGuardFresh(
							operations,
							inspectKometaCollisionGuard(liveConfig, kometaMigrationCollisionState(liveMigration))
						);
						coordinator.assertKometaFresh(operations, raw);
						if (isCancelled?.()) throw new Error('cancelled');
					}
				});
			},
			prepareOperation: coordinator.prepareOperation,
			executeServerOperation: coordinator.executeServerOperation,
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
	await refreshAppliedCoverage(result);
	return result;
}

/**
 * Re-derive coverage for exactly the occurrences this plan touched.
 *
 * After `finalize` rather than before: the revision group is closed by then, so
 * reconciliation reads a ledger whose outcomes and verifications are final
 * instead of a half-written one. Scoped to the plan's items because a plan is
 * the unit the user just acted on — rebuilding the whole server here would make
 * a five-item apply pay for a forty-thousand-item library.
 *
 * A refresh failure is swallowed: an apply that succeeded and then could not
 * update a cache is still a successful apply, and the next sync, undo, or stale
 * read rebuilds what this pass missed.
 */
async function refreshAppliedCoverage(result: ApplyPlanExecutionResult): Promise<void> {
	const byServer = new Map<string, Set<number>>();
	for (const item of result.items) {
		let ids = byServer.get(item.serverInstanceId);
		if (!ids) {
			ids = new Set<number>();
			byServer.set(item.serverInstanceId, ids);
		}
		ids.add(item.mediaItemId);
	}
	// Cross-server applies write to several servers in one plan, and coverage is
	// per occurrence, so each server's copies are reconciled in their own scope.
	for (const [serverInstanceId, mediaItemIds] of byServer) {
		await refreshCoverageAfter('apply', { serverInstanceId, mediaItemIds: [...mediaItemIds] });
	}
}

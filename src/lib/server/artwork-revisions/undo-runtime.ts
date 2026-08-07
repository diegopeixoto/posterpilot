import { env } from '$env/dynamic/private';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import type { AppConfig } from '$lib/server/config';
import { resolveConfig } from '$lib/server/config';
import { resolveDataPaths } from '$lib/server/data-paths';
import { db } from '$lib/server/db';
import {
	canonicalConfigPath,
	freezeConfigPath,
	readConfigAtBinding,
	recoverConfigQuarantineAtBinding,
	withConfigLocks,
	writeConfigAtomicAtBinding,
	type ConfigPathBinding
} from '$lib/server/kometa/config-io';
import {
	kometaBindingErrorCode,
	resolveKometaServerBinding,
	type ResolvedKometaServerBinding
} from '$lib/server/kometa/server-binding';
import { assertNoPendingKometaConfigMutationWhileOwned } from '$lib/server/kometa/config-mutation-recovery';
import { LEGACY_FILENAME, kometaYamlMappingKey } from '$lib/server/kometa/destination';
import {
	withKometaMigrationControlLock,
	type KometaMigrationControlLease
} from '$lib/server/kometa/migration-control-lock';
import {
	kometaMigrationCollisionState,
	type KometaMigrationCollisionState
} from '$lib/server/kometa/migration-state';
import { loadKometaMigrationJournalForGuard } from '$lib/server/kometa/migration-store';
import { enqueueJobDetailed } from '$lib/server/jobs/runner';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import {
	inspectKometaCollisionGuard,
	kometaOutputDirectory
} from '$lib/server/plans/apply-destinations';
import { createDatabaseApplyServerRegistry } from '$lib/server/plans/apply-server-registry';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { getMediaItem } from '$lib/server/queries';
import {
	kometaSlotFingerprint,
	readKometaSlot,
	restoreKometaSlot
} from '$lib/server/revisions/kometa-state';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { createArtworkRevisionLedger } from './ledger';
import { ArtworkSnapshotStore, resolveArtworkSnapshotDirectory } from './snapshot-store';
import { createArtworkSnapshotRepository } from './snapshots';
import {
	createArtworkUndoExecutor,
	type ArtworkUndoExecutionResult,
	type ArtworkUndoExecutor,
	type ArtworkUndoKometaPreflightTarget,
	type ExecuteArtworkUndoInput,
	type UndoKometaMutationInput
} from './undo-executor';
import {
	assertUndoPlanPayload,
	UNDO_PLAN_KIND,
	type FrozenUndoJobPayload,
	type UndoPlanPayloadV1,
	type UndoPlanScope,
	type UndoPlanSlot
} from './undo-plan';
import {
	confirmArtworkUndoPlan,
	createArtworkUndoPlanner,
	type ArtworkUndoPlannerDependencies,
	type ArtworkUndoPreview,
	type ConfirmedArtworkUndoPlan,
	type UndoKometaDestination
} from './undo-planner';

export type ActiveItemUndoScope =
	| { kind: 'item' }
	| { kind: 'revision'; revisionId: string }
	| { kind: 'slot'; slot: UndoPlanSlot }
	| { kind: 'season'; season: number }
	| { kind: 'destination'; destination: 'server' | 'kometa' }
	| { kind: 'group'; revisionGroupId: string };

export interface PreviewActiveItemArtworkUndoInput {
	mediaItemId: number;
	scope?: ActiveItemUndoScope;
}

export interface ConfirmActiveItemArtworkUndoInput {
	mediaItemId: number;
	planId: string;
	digest: string;
}

/** Confirmation hands the frozen plan to the durable queue and returns its job. */
export interface ConfirmedArtworkUndoJob {
	jobId: number;
	planId: string;
	digest: string;
	operationCount: number;
}

type ArtworkUndoRuntimeErrorCode =
	| 'invalid_request'
	| 'server_instance_not_found'
	| 'item_not_found'
	| 'undo_scope_not_found'
	| 'plan_scope_mismatch'
	| 'kometa_server_binding_mismatch'
	| 'undo_kometa_unavailable'
	| 'undo_kometa_write_failed'
	| 'plan_stale';

/** Locale-neutral runtime failure. No path, URL, credential, or YAML value is retained. */
class ArtworkUndoRuntimeError extends Error {
	constructor(readonly code: ArtworkUndoRuntimeErrorCode | string) {
		super(code);
		this.name = 'ArtworkUndoRuntimeError';
	}
}

interface ActiveItemRecord {
	id: number;
	serverInstanceId: string;
}

interface UndoPlanInspector {
	validate<T = unknown>(
		id: string,
		expectations?: {
			kind?: string;
			digest?: string;
			serverInstanceId?: string | null;
		}
	): Promise<{ payload: T }>;
}

export interface ArtworkUndoRuntimeDependencies {
	plannerDependencies: ArtworkUndoPlannerDependencies;
	planStore: UndoPlanInspector;
	/** Hands the consumed, frozen plan to the durable worker. */
	enqueue(payload: FrozenUndoJobPayload): Promise<number>;
	getActiveServerInstanceId(): Promise<string | null>;
	getItem(mediaItemId: number, serverInstanceId: string): Promise<ActiveItemRecord | null>;
	mutationsAllowed?(): void;
	previewPlan?: ReturnType<typeof createArtworkUndoPlanner>;
	confirmPlan?: (
		input: Parameters<typeof confirmArtworkUndoPlan>[0]
	) => Promise<ConfirmedArtworkUndoPlan>;
}

function positiveItemId(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function validIdentifier(value: string): boolean {
	return value.length > 0 && value.trim() === value;
}

function assertSlot(slot: UndoPlanSlot): void {
	if (!['poster', 'background', 'title_card'].includes(slot.kind)) {
		throw new ArtworkUndoRuntimeError('invalid_request');
	}
	if (slot.season !== null && (!Number.isSafeInteger(slot.season) || slot.season < 0)) {
		throw new ArtworkUndoRuntimeError('invalid_request');
	}
	if (slot.episode !== null && (!Number.isSafeInteger(slot.episode) || slot.episode < 0)) {
		throw new ArtworkUndoRuntimeError('invalid_request');
	}
	if (slot.kind === 'title_card') {
		if (slot.season === null || slot.episode === null) {
			throw new ArtworkUndoRuntimeError('invalid_request');
		}
	} else if (slot.episode !== null) {
		throw new ArtworkUndoRuntimeError('invalid_request');
	}
}

function scopedUndoPlan(
	serverInstanceId: string,
	mediaItemId: number,
	scope: ActiveItemUndoScope
): UndoPlanScope {
	switch (scope.kind) {
		case 'item':
			return { kind: 'item', serverInstanceId, mediaItemId };
		case 'revision':
			if (!validIdentifier(scope.revisionId)) {
				throw new ArtworkUndoRuntimeError('invalid_request');
			}
			return { kind: 'revision', serverInstanceId, revisionId: scope.revisionId };
		case 'slot':
			assertSlot(scope.slot);
			return {
				kind: 'slot',
				serverInstanceId,
				target: { kind: 'item', mediaItemId },
				slot: scope.slot
			};
		case 'season':
			if (!Number.isSafeInteger(scope.season) || scope.season < 0) {
				throw new ArtworkUndoRuntimeError('invalid_request');
			}
			return { kind: 'season', serverInstanceId, mediaItemId, season: scope.season };
		case 'destination':
			if (scope.destination !== 'server' && scope.destination !== 'kometa') {
				throw new ArtworkUndoRuntimeError('invalid_request');
			}
			return {
				kind: 'destination',
				serverInstanceId,
				target: { kind: 'item', mediaItemId },
				destination: scope.destination
			};
		case 'group':
			if (!validIdentifier(scope.revisionGroupId)) {
				throw new ArtworkUndoRuntimeError('invalid_request');
			}
			return {
				kind: 'group',
				serverInstanceId,
				revisionGroupId: scope.revisionGroupId
			};
	}
}

function planContainsItem(payload: UndoPlanPayloadV1, mediaItemId: number): boolean {
	return payload.operations.some(
		(operation) => operation.target.kind === 'item' && operation.target.mediaItemId === mediaItemId
	);
}

function previewContainsItem(preview: ArtworkUndoPreview, mediaItemId: number): boolean {
	return preview.operations.some(
		(operation) => operation.target.kind === 'item' && operation.target.mediaItemId === mediaItemId
	);
}

/**
 * Bind the generic planner/executor to the active item route. The item in the URL
 * is an authorization anchor even for revision/group scopes and is checked again
 * before the single-use plan is consumed.
 */
export function createArtworkUndoRuntime(dependencies: ArtworkUndoRuntimeDependencies) {
	const mutationsAllowed = dependencies.mutationsAllowed ?? assertMutationsAllowed;
	const previewPlan =
		dependencies.previewPlan ?? createArtworkUndoPlanner(dependencies.plannerDependencies);
	const confirmPlan =
		dependencies.confirmPlan ??
		((input: Parameters<typeof confirmArtworkUndoPlan>[0]) =>
			confirmArtworkUndoPlan(input, dependencies.plannerDependencies));

	async function activeItem(mediaItemId: number): Promise<ActiveItemRecord> {
		if (!positiveItemId(mediaItemId)) throw new ArtworkUndoRuntimeError('invalid_request');
		const serverInstanceId = await dependencies.getActiveServerInstanceId();
		if (!serverInstanceId) {
			throw new ArtworkUndoRuntimeError('server_instance_not_found');
		}
		const item = await dependencies.getItem(mediaItemId, serverInstanceId);
		if (!item || item.id !== mediaItemId || item.serverInstanceId !== serverInstanceId) {
			throw new ArtworkUndoRuntimeError('item_not_found');
		}
		return item;
	}

	async function preview(input: PreviewActiveItemArtworkUndoInput): Promise<ArtworkUndoPreview> {
		mutationsAllowed();
		const item = await activeItem(input.mediaItemId);
		const scope = scopedUndoPlan(item.serverInstanceId, item.id, input.scope ?? { kind: 'item' });
		const result = await previewPlan({ scope });
		if (!previewContainsItem(result, item.id)) {
			throw new ArtworkUndoRuntimeError('undo_scope_not_found');
		}
		return result;
	}

	async function confirm(
		input: ConfirmActiveItemArtworkUndoInput
	): Promise<ConfirmedArtworkUndoJob> {
		mutationsAllowed();
		const item = await activeItem(input.mediaItemId);
		if (!validIdentifier(input.planId) || !/^[a-f0-9]{64}$/.test(input.digest)) {
			throw new ArtworkUndoRuntimeError('invalid_request');
		}
		const inspected = await dependencies.planStore.validate<unknown>(input.planId, {
			kind: UNDO_PLAN_KIND,
			digest: input.digest,
			serverInstanceId: item.serverInstanceId
		});
		try {
			assertUndoPlanPayload(inspected.payload);
		} catch {
			throw new ArtworkUndoRuntimeError('plan_scope_mismatch');
		}
		if (
			inspected.payload.scope.serverInstanceId !== item.serverInstanceId ||
			!planContainsItem(inspected.payload, item.id)
		) {
			throw new ArtworkUndoRuntimeError('plan_scope_mismatch');
		}

		const confirmed = await confirmPlan({
			planId: input.planId,
			digest: input.digest,
			serverInstanceId: item.serverInstanceId
		});
		if (!planContainsItem(confirmed.payload, item.id)) {
			throw new ArtworkUndoRuntimeError('plan_scope_mismatch');
		}
		// The plan is consumed here, so the frozen payload — not the plan id — is what
		// the worker replays. A restart mid-undo therefore resumes the same operations
		// instead of losing them with the request that started them.
		const jobId = await dependencies.enqueue({
			kind: 'undo',
			planId: confirmed.planId,
			digest: confirmed.digest,
			plan: confirmed.payload
		});
		return {
			jobId,
			planId: confirmed.planId,
			digest: confirmed.digest,
			operationCount: confirmed.payload.summary.operationCount
		};
	}

	return { preview, confirm };
}

export interface BoundKometaUndoAccessDependencies {
	loadConfig(): Promise<AppConfig>;
	resolveBinding(serverInstanceId: string | null): Promise<ResolvedKometaServerBinding>;
	loadMigrationState(serverInstanceId: string): Promise<KometaMigrationCollisionState | null>;
	assertNoPendingConfigMutationWhileOwned?(
		assertControlLockOwned: () => Promise<KometaMigrationControlLease>
	): Promise<unknown>;
	freezePath(path: string): ConfigPathBinding;
	readAtBinding(binding: ConfigPathBinding): string | null;
	recoverAtBinding(binding: ConfigPathBinding): unknown;
	writeAtBinding(
		binding: ConfigPathBinding,
		text: string,
		stamp: string,
		opts: { expectedSource: string | null }
	): unknown;
	withLocks<T>(paths: readonly string[], operation: () => Promise<T>): Promise<T>;
	withControlLock<T>(
		operation: (assertOwned: () => Promise<KometaMigrationControlLease>) => Promise<T>
	): Promise<T>;
	clock?: () => Date;
}

interface BoundKometaUndoTarget {
	config: AppConfig;
	path: string;
	guardPaths: string[];
}

interface ActiveBoundKometaUndoCommit {
	serverInstanceId: string;
	destinationKey: string;
	binding: ConfigPathBinding;
	assertOwned: () => Promise<void>;
}

async function boundKometaTarget(
	serverInstanceId: string,
	destination: UndoKometaDestination,
	dependencies: BoundKometaUndoAccessDependencies
): Promise<BoundKometaUndoTarget> {
	const config = await dependencies.loadConfig();
	if (config.kometaServerInstanceId !== serverInstanceId) {
		throw new ArtworkUndoRuntimeError('kometa_server_binding_mismatch');
	}
	const resolvedBinding = await dependencies.resolveBinding(config.kometaServerInstanceId);
	if (resolvedBinding.status !== 'ready' || resolvedBinding.binding?.id !== serverInstanceId) {
		const code =
			resolvedBinding.status === 'ready'
				? 'kometa_server_binding_mismatch'
				: kometaBindingErrorCode(resolvedBinding.status);
		throw new ArtworkUndoRuntimeError(code);
	}
	const outputDirectory = kometaOutputDirectory(config);
	const path = resolve(outputDirectory, destination.filename);
	const guardPaths = new Set<string>();
	if (config.kometaConfigPath) guardPaths.add(config.kometaConfigPath);
	guardPaths.add(resolve(outputDirectory, LEGACY_FILENAME));
	guardPaths.add(path);
	return {
		config,
		path,
		guardPaths: [...guardPaths].sort((first, second) =>
			first < second ? -1 : first > second ? 1 : 0
		)
	};
}

function sameOptionalConfigPath(first: string | null, second: string | null): boolean {
	return (
		(first === null && second === null) ||
		(first !== null &&
			second !== null &&
			canonicalConfigPath(first) === canonicalConfigPath(second))
	);
}

function assertSameKometaUndoTarget(
	planned: BoundKometaUndoTarget,
	live: BoundKometaUndoTarget,
	binding: ConfigPathBinding
): void {
	if (
		planned.config.kometaServerInstanceId !== live.config.kometaServerInstanceId ||
		planned.config.kometaMetadataPathPrefix !== live.config.kometaMetadataPathPrefix ||
		!sameOptionalConfigPath(planned.config.kometaConfigPath, live.config.kometaConfigPath) ||
		canonicalConfigPath(kometaOutputDirectory(planned.config)) !==
			canonicalConfigPath(kometaOutputDirectory(live.config)) ||
		canonicalConfigPath(live.path) !== binding.canonicalPath
	) {
		throw new ArtworkUndoRuntimeError('plan_stale');
	}
}

function assertMigrationAllowsKometaUndo(
	config: AppConfig,
	destination: UndoKometaDestination,
	migration: KometaMigrationCollisionState | null
): void {
	if (migration && migration.status !== 'completed' && migration.status !== 'rolled_back') {
		throw new ArtworkUndoRuntimeError('plan_stale');
	}
	if (
		destination.version === 2 &&
		inspectKometaCollisionGuard(config, migration).migrationRequired
	) {
		throw new ArtworkUndoRuntimeError('plan_stale');
	}
}

function currentKometaMatches(
	current: ReturnType<typeof readKometaSlot>,
	expected: UndoKometaMutationInput['expectedCurrent']
): boolean {
	if (current.state !== expected.state) return false;
	if (current.state === 'absent') return expected.fingerprint === null;
	return kometaSlotFingerprint(current) === expected.fingerprint;
}

/**
 * One-file Kometa adapter with physical-path CAS and a cross-process migration fence.
 * Config/legacy/target path locks are always acquired before the durable control lease.
 */
export function createBoundKometaUndoAccess(dependencies: BoundKometaUndoAccessDependencies) {
	const clock = dependencies.clock ?? (() => new Date());
	const assertNoPendingConfigMutationWhileOwned =
		dependencies.assertNoPendingConfigMutationWhileOwned ??
		assertNoPendingKometaConfigMutationWhileOwned;
	const activeCommit = new AsyncLocalStorage<ActiveBoundKometaUndoCommit>();

	async function preflightKometa(
		targets: readonly ArtworkUndoKometaPreflightTarget[]
	): Promise<void> {
		const uniqueTargets = new Map<string, ArtworkUndoKometaPreflightTarget>();
		for (const target of targets) {
			uniqueTargets.set(`${target.serverInstanceId}\0${target.destination.key}`, target);
		}
		if (uniqueTargets.size === 0) return;
		const planned = await Promise.all(
			[...uniqueTargets.values()].map(async (target) => {
				const resolved = await boundKometaTarget(
					target.serverInstanceId,
					target.destination,
					dependencies
				);
				return { target, resolved, binding: dependencies.freezePath(resolved.path) };
			})
		);
		const guardPaths = [...new Set(planned.flatMap(({ resolved }) => resolved.guardPaths))].sort(
			(first, second) => (first < second ? -1 : first > second ? 1 : 0)
		);
		await dependencies.withLocks(guardPaths, () =>
			dependencies.withControlLock(async (assertControlLockOwned) => {
				await assertControlLockOwned();
				try {
					await assertNoPendingConfigMutationWhileOwned(assertControlLockOwned);
				} catch {
					throw new ArtworkUndoRuntimeError('plan_stale');
				}
				const migrations = new Map<string, Promise<KometaMigrationCollisionState | null>>();
				for (const { target, resolved, binding } of planned) {
					let migration = migrations.get(target.serverInstanceId);
					if (!migration) {
						migration = dependencies.loadMigrationState(target.serverInstanceId);
						migrations.set(target.serverInstanceId, migration);
					}
					const [live, liveMigration] = await Promise.all([
						boundKometaTarget(target.serverInstanceId, target.destination, dependencies),
						migration
					]);
					assertSameKometaUndoTarget(resolved, live, binding);
					assertMigrationAllowsKometaUndo(live.config, target.destination, liveMigration);
				}
				await assertControlLockOwned();
			})
		);
	}

	async function withKometaCommit<T>(
		serverInstanceId: string,
		destination: UndoKometaDestination,
		commit: (assertOwned: () => Promise<void>) => Promise<T>
	): Promise<T> {
		const planned = await boundKometaTarget(serverInstanceId, destination, dependencies);
		const binding = dependencies.freezePath(planned.path);
		return dependencies.withLocks(planned.guardPaths, () =>
			dependencies.withControlLock(async (assertControlLockOwned) => {
				const assertOwned = async (): Promise<void> => {
					await assertControlLockOwned();
					const [live, migration] = await Promise.all([
						boundKometaTarget(serverInstanceId, destination, dependencies),
						dependencies.loadMigrationState(serverInstanceId),
						assertNoPendingConfigMutationWhileOwned(assertControlLockOwned).catch(() => {
							throw new ArtworkUndoRuntimeError('plan_stale');
						})
					]);
					assertSameKometaUndoTarget(planned, live, binding);
					assertMigrationAllowsKometaUndo(live.config, destination, migration);
					// No writer following the control protocol can install a migration or
					// config checkpoint after this assertion and before synchronous bound I/O.
					await assertControlLockOwned();
				};

				await assertOwned();
				dependencies.recoverAtBinding(binding);
				await assertOwned();
				return activeCommit.run(
					{
						serverInstanceId,
						destinationKey: destination.key,
						binding,
						assertOwned
					},
					() => commit(assertOwned)
				);
			})
		);
	}

	async function readKometa(
		serverInstanceId: string,
		destination: UndoKometaDestination
	): Promise<string | null> {
		const current = activeCommit.getStore();
		if (
			current?.serverInstanceId === serverInstanceId &&
			current.destinationKey === destination.key
		) {
			return dependencies.readAtBinding(current.binding);
		}
		const target = await boundKometaTarget(serverInstanceId, destination, dependencies);
		return dependencies.withLocks([target.path], async () => {
			const binding = dependencies.freezePath(target.path);
			return dependencies.readAtBinding(binding);
		});
	}

	async function mutateKometa(
		input: UndoKometaMutationInput,
		assertCommitOwned?: () => Promise<void>
	): Promise<void> {
		const currentCommit = activeCommit.getStore();
		if (
			!currentCommit ||
			currentCommit.serverInstanceId !== input.serverInstanceId ||
			currentCommit.destinationKey !== input.destination.key
		) {
			return withKometaCommit(input.serverInstanceId, input.destination, (assertOwned) =>
				mutateKometa(input, assertCommitOwned ?? assertOwned)
			);
		}
		const assertOwned = async (): Promise<void> => {
			// The active runtime fence is authoritative. A caller-supplied assertion may
			// only strengthen it; it must never replace or weaken lease ownership.
			await currentCommit.assertOwned();
			await assertCommitOwned?.();
		};
		await assertOwned();
		const source = dependencies.readAtBinding(currentCommit.binding);
		const raw = source ?? '';
		try {
			let current: ReturnType<typeof readKometaSlot>;
			try {
				current = readKometaSlot(raw, kometaYamlMappingKey(input.destination), input.slot);
			} catch {
				throw new ArtworkUndoRuntimeError('undo_kometa_unavailable');
			}
			if (!currentKometaMatches(current, input.expectedCurrent)) {
				throw new ArtworkUndoRuntimeError('plan_stale');
			}

			const next = restoreKometaSlot(
				raw,
				kometaYamlMappingKey(input.destination),
				input.slot,
				input.restore
			);
			const stamp = new Date(clock().getTime());
			if (!Number.isFinite(stamp.getTime())) {
				throw new ArtworkUndoRuntimeError('undo_kometa_write_failed');
			}
			// This is the final await before synchronous bound compare-and-set I/O.
			await assertOwned();
			dependencies.writeAtBinding(currentCommit.binding, next, stamp.toISOString(), {
				expectedSource: source
			});
			await assertOwned();
		} catch (error) {
			if (error instanceof ArtworkUndoRuntimeError) throw error;
			throw new ArtworkUndoRuntimeError('undo_kometa_write_failed');
		}
	}

	return { preflightKometa, readKometa, mutateKometa, withKometaCommit };
}

let liveRuntime: ReturnType<typeof createArtworkUndoRuntime> | null = null;
let liveExecutor: ArtworkUndoExecutor | null = null;

/** Shared executor wiring: confirmation enqueues, and the worker executes with it. */
function executor(): ArtworkUndoExecutor {
	if (liveExecutor) return liveExecutor;
	const serverRegistry = createDatabaseApplyServerRegistry();
	const snapshotStore = new ArtworkSnapshotStore(
		resolveArtworkSnapshotDirectory(resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE))
	);
	const kometa = createBoundKometaUndoAccess({
		loadConfig: resolveConfig,
		resolveBinding: resolveKometaServerBinding,
		loadMigrationState: async (serverInstanceId) =>
			kometaMigrationCollisionState(await loadKometaMigrationJournalForGuard(serverInstanceId)),
		freezePath: freezeConfigPath,
		readAtBinding: readConfigAtBinding,
		recoverAtBinding: recoverConfigQuarantineAtBinding,
		writeAtBinding: writeConfigAtomicAtBinding,
		withLocks: withConfigLocks,
		withControlLock: withKometaMigrationControlLock
	});
	liveExecutor = createArtworkUndoExecutor({
		serverRegistry,
		snapshots: createArtworkSnapshotRepository(db, snapshotStore),
		ledger: createArtworkRevisionLedger(db),
		preflightKometa: kometa.preflightKometa,
		readKometa: kometa.readKometa,
		mutateKometa: kometa.mutateKometa,
		withKometaCommit: kometa.withKometaCommit
	});
	return liveExecutor;
}

function runtime() {
	if (liveRuntime) return liveRuntime;
	const serverRegistry = createDatabaseApplyServerRegistry();
	const kometa = createBoundKometaUndoAccess({
		loadConfig: resolveConfig,
		resolveBinding: resolveKometaServerBinding,
		loadMigrationState: async (serverInstanceId) =>
			kometaMigrationCollisionState(await loadKometaMigrationJournalForGuard(serverInstanceId)),
		freezePath: freezeConfigPath,
		readAtBinding: readConfigAtBinding,
		recoverAtBinding: recoverConfigQuarantineAtBinding,
		writeAtBinding: writeConfigAtomicAtBinding,
		withLocks: withConfigLocks,
		withControlLock: withKometaMigrationControlLock
	});
	const plannerDependencies: ArtworkUndoPlannerDependencies = {
		database: db,
		serverRegistry,
		readKometa: kometa.readKometa,
		planStore: operationPlanStore
	};
	liveRuntime = createArtworkUndoRuntime({
		plannerDependencies,
		planStore: operationPlanStore,
		enqueue: async (payload) => (await enqueueJobDetailed(payload, { trigger: 'undo' })).jobId,
		getActiveServerInstanceId: async () => (await getActiveServerInstance())?.id ?? null,
		getItem: async (mediaItemId, serverInstanceId) => {
			const item = await getMediaItem(mediaItemId, serverInstanceId);
			return item ? { id: item.id, serverInstanceId: item.serverInstanceId } : null;
		}
	});
	return liveRuntime;
}

/** Execute a frozen undo job. Called by the durable worker, never by a request. */
export function executeFrozenArtworkUndoJob(
	input: ExecuteArtworkUndoInput
): Promise<ArtworkUndoExecutionResult> {
	return executor()(input);
}

export function previewActiveItemArtworkUndo(
	input: PreviewActiveItemArtworkUndoInput
): Promise<ArtworkUndoPreview> {
	return runtime().preview(input);
}

export function confirmActiveItemArtworkUndo(
	input: ConfirmActiveItemArtworkUndoInput
): Promise<ConfirmedArtworkUndoJob> {
	return runtime().confirm(input);
}

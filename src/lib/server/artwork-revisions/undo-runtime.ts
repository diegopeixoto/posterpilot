import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import type { AppConfig } from '$lib/server/config';
import { resolveConfig } from '$lib/server/config';
import { resolveDataPaths } from '$lib/server/data-paths';
import { db } from '$lib/server/db';
import { readConfig, withConfigLock, writeConfigAtomic } from '$lib/server/kometa/config-io';
import {
	kometaBindingErrorCode,
	resolveKometaServerBinding,
	type ResolvedKometaServerBinding
} from '$lib/server/kometa/server-binding';
import { DEFAULT_FILENAME } from '$lib/server/kometa/yaml';
import { enqueueJobDetailed } from '$lib/server/jobs/runner';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { kometaOutputDirectory } from '$lib/server/plans/apply-destinations';
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
	type ConfirmedArtworkUndoPlan
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

export type ArtworkUndoRuntimeErrorCode =
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
	read(path: string): string | null;
	write(path: string, text: string, stamp: string): unknown;
	withLock<T>(path: string, operation: () => Promise<T>): Promise<T>;
	clock?: () => Date;
}

async function boundKometaPath(
	serverInstanceId: string,
	dependencies: BoundKometaUndoAccessDependencies
): Promise<string> {
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
	return resolve(kometaOutputDirectory(config), DEFAULT_FILENAME);
}

function currentKometaMatches(
	current: ReturnType<typeof readKometaSlot>,
	expected: UndoKometaMutationInput['expectedCurrent']
): boolean {
	if (current.state !== expected.state) return false;
	if (current.state === 'absent') return expected.fingerprint === null;
	return kometaSlotFingerprint(current) === expected.fingerprint;
}

/** One-file Kometa adapter with a lock-scoped compare-and-set and atomic replacement. */
export function createBoundKometaUndoAccess(dependencies: BoundKometaUndoAccessDependencies) {
	const clock = dependencies.clock ?? (() => new Date());

	async function readKometa(serverInstanceId: string): Promise<string | null> {
		const path = await boundKometaPath(serverInstanceId, dependencies);
		return dependencies.read(path);
	}

	async function mutateKometa(input: UndoKometaMutationInput): Promise<void> {
		const plannedPath = await boundKometaPath(input.serverInstanceId, dependencies);
		await dependencies.withLock(plannedPath, async () => {
			// Settings/binding may change while waiting for the file lock. Never write
			// the previously resolved path under a different live binding.
			const currentPath = await boundKometaPath(input.serverInstanceId, dependencies);
			if (currentPath !== plannedPath) throw new ArtworkUndoRuntimeError('plan_stale');
			const raw = dependencies.read(currentPath) ?? '';
			let current: ReturnType<typeof readKometaSlot>;
			try {
				current = readKometaSlot(raw, input.tmdbId, input.slot);
			} catch {
				throw new ArtworkUndoRuntimeError('undo_kometa_unavailable');
			}
			if (!currentKometaMatches(current, input.expectedCurrent)) {
				throw new ArtworkUndoRuntimeError('plan_stale');
			}

			let next: string;
			try {
				next = restoreKometaSlot(raw, input.tmdbId, input.slot, input.restore);
				const stamp = new Date(clock().getTime());
				if (!Number.isFinite(stamp.getTime())) {
					throw new ArtworkUndoRuntimeError('undo_kometa_write_failed');
				}
				dependencies.write(currentPath, next, stamp.toISOString());
			} catch (error) {
				if (error instanceof ArtworkUndoRuntimeError) throw error;
				throw new ArtworkUndoRuntimeError('undo_kometa_write_failed');
			}
		});
	}

	return { readKometa, mutateKometa };
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
		read: readConfig,
		write: writeConfigAtomic,
		withLock: withConfigLock
	});
	liveExecutor = createArtworkUndoExecutor({
		serverRegistry,
		snapshots: createArtworkSnapshotRepository(db, snapshotStore),
		ledger: createArtworkRevisionLedger(db),
		readKometa: kometa.readKometa,
		mutateKometa: kometa.mutateKometa
	});
	return liveExecutor;
}

function runtime() {
	if (liveRuntime) return liveRuntime;
	const serverRegistry = createDatabaseApplyServerRegistry();
	const kometa = createBoundKometaUndoAccess({
		loadConfig: resolveConfig,
		resolveBinding: resolveKometaServerBinding,
		read: readConfig,
		write: writeConfigAtomic,
		withLock: withConfigLock
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

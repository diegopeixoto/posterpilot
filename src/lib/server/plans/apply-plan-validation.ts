import { canonicalJson, hashCanonicalJson } from './canonical-json';
import {
	APPLY_PLAN_KIND,
	APPLY_PLAN_VERSION,
	applySlotKey,
	type ApplyPlanPayloadV1,
	type FrozenArtworkSelection
} from './apply-plan';
import {
	freezeApplyCandidateSelection,
	freezeApplyDiscoverySnapshot,
	freezeApplyStoredSelection,
	type ApplyItemRef,
	type ApplyPlannerItemData,
	type ResolveApplyDestinationsInput
} from './apply-planner';

export type ApplyPlanValidationErrorCode = 'invalid_plan' | 'plan_stale' | 'plan_scope_mismatch';

export class ApplyPlanValidationError extends Error {
	constructor(
		readonly code: ApplyPlanValidationErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ApplyPlanValidationError';
	}
}

export interface ApplyPlanFreshnessResolverDependencies {
	loadItemData(ref: ApplyItemRef): Promise<ApplyPlannerItemData | null>;
	resolveDestinationSlots: (
		input: ResolveApplyDestinationsInput
	) => Promise<import('./apply-plan').DestinationSlotSnapshot[]>;
	validateContext?(payload: ApplyPlanPayloadV1): Promise<void>;
}

function failInvalid(message: string): never {
	throw new ApplyPlanValidationError('invalid_plan', message);
}

function failStale(message: string): never {
	throw new ApplyPlanValidationError('plan_stale', message);
}

function same(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values)].sort();
}

function validSlot(slot: { kind: string; season: number | null; episode: number | null }): boolean {
	if (!['poster', 'background', 'title_card'].includes(slot.kind)) return false;
	if (slot.season !== null && (!Number.isInteger(slot.season) || slot.season < 0)) return false;
	if (slot.episode !== null && (!Number.isInteger(slot.episode) || slot.episode < 0)) return false;
	if (slot.kind === 'title_card') return slot.season !== null && slot.episode !== null;
	return slot.episode === null;
}

function externalIdentity(
	item: { tmdbId: string | null; imdbId: string | null; tvdbId: string | null },
	match: { namespace: 'tmdb' | 'imdb' | 'tvdb'; value: string }
): string | null {
	if (match.namespace === 'tmdb') return item.tmdbId;
	if (match.namespace === 'imdb') return item.imdbId;
	return item.tvdbId;
}

function assertCrossServerContext(payload: ApplyPlanPayloadV1): void {
	if (payload.context.source !== 'cross_server') return;
	const context = payload.context;
	if (
		!context.sourceItem?.serverInstanceId ||
		!Number.isSafeInteger(context.sourceItem.mediaItemId) ||
		context.sourceItem.mediaItemId <= 0 ||
		!['tmdb', 'imdb', 'tvdb'].includes(context.match?.namespace) ||
		!context.match.value ||
		externalIdentity(context.sourceItem, context.match) !== context.match.value ||
		(context.match.namespace === 'tmdb' && context.sourceItem.mediaType === null) ||
		!Array.isArray(context.destinationServerInstanceIds) ||
		!Array.isArray(context.resolutions)
	) {
		failInvalid('Invalid frozen cross-server context');
	}
	const destinationServerInstanceIds = context.destinationServerInstanceIds;
	if (
		destinationServerInstanceIds.length === 0 ||
		new Set(destinationServerInstanceIds).size !== destinationServerInstanceIds.length ||
		destinationServerInstanceIds.includes(context.sourceItem.serverInstanceId) ||
		!same(destinationServerInstanceIds, [...destinationServerInstanceIds].sort()) ||
		destinationServerInstanceIds.some(
			(serverInstanceId) => !serverInstanceId || serverInstanceId.trim() !== serverInstanceId
		)
	) {
		failInvalid('Invalid frozen cross-server destinations');
	}
	if (
		context.resolutions.length !== destinationServerInstanceIds.length ||
		new Set(context.resolutions.map((resolution) => resolution.serverInstanceId)).size !==
			context.resolutions.length
	) {
		failInvalid('Invalid frozen cross-server resolutions');
	}
	const matched = new Map<string, number>();
	for (let index = 0; index < context.resolutions.length; index += 1) {
		const resolution = context.resolutions[index];
		if (
			resolution.serverInstanceId !== destinationServerInstanceIds[index] ||
			!['matched', 'not_found', 'ambiguous', 'server_not_found', 'server_disabled'].includes(
				resolution.status
			) ||
			!Array.isArray(resolution.candidateItemIds) ||
			new Set(resolution.candidateItemIds).size !== resolution.candidateItemIds.length ||
			!same(
				resolution.candidateItemIds,
				[...resolution.candidateItemIds].sort((a, b) => a - b)
			) ||
			resolution.candidateItemIds.some((itemId) => !Number.isSafeInteger(itemId) || itemId <= 0) ||
			(resolution.status === 'matched'
				? resolution.candidateItemIds.length !== 1
				: resolution.status === 'ambiguous'
					? resolution.candidateItemIds.length < 2
					: resolution.candidateItemIds.length !== 0)
		) {
			failInvalid('Invalid frozen cross-server resolution');
		}
		if (resolution.status === 'matched') {
			matched.set(resolution.serverInstanceId, resolution.candidateItemIds[0]);
		}
	}
	if (payload.items.length !== matched.size) {
		failInvalid('Frozen cross-server targets do not match their resolutions');
	}
	for (const item of payload.items) {
		if (
			matched.get(item.target.serverInstanceId) !== item.target.mediaItemId ||
			!same(item.selectionFrom, context.sourceItem) ||
			externalIdentity(item.target, context.match) !== context.match.value ||
			item.target.type !== context.sourceItem.type ||
			(context.match.namespace === 'tmdb' && item.target.mediaType !== context.sourceItem.mediaType)
		) {
			failInvalid('Frozen cross-server item identity is inconsistent');
		}
	}
}

function assertCollectionContext(payload: ApplyPlanPayloadV1): void {
	if (payload.context.source !== 'collection') return;
	if (
		!payload.context.collectionId ||
		payload.context.collectionId.trim() !== payload.context.collectionId ||
		!payload.context.membershipFingerprint ||
		payload.context.membershipFingerprint.trim() !== payload.context.membershipFingerprint ||
		payload.scope.serverInstanceIds.length !== 1
	) {
		failInvalid('Invalid frozen collection context');
	}
}

/** Structural and internal-integrity checks beyond the operation-plan row digest. */
export function assertApplyPlanPayload(payload: ApplyPlanPayloadV1): void {
	if (
		!payload ||
		payload.type !== APPLY_PLAN_KIND ||
		payload.version !== APPLY_PLAN_VERSION ||
		!Array.isArray(payload.items) ||
		!payload.context ||
		!payload.defaults ||
		!payload.scope ||
		!payload.summary ||
		!['server', 'kometa', 'both'].includes(payload.defaults.effectiveMethod) ||
		!['auto', 'stored'].includes(payload.defaults.selectionMode) ||
		!Array.isArray(payload.scope.serverInstanceIds) ||
		!Array.isArray(payload.scope.librarySectionKeys) ||
		!Array.isArray(payload.scope.targetItemIds)
	) {
		failInvalid('Unsupported frozen apply plan payload');
	}
	if (typeof payload.plannedAt !== 'string' || !Number.isFinite(Date.parse(payload.plannedAt))) {
		failInvalid('Invalid apply plan timestamp');
	}

	const expectedDestinations =
		payload.defaults.effectiveMethod === 'both'
			? new Set(['server', 'kometa'])
			: new Set([payload.defaults.effectiveMethod]);
	const operationIds = new Set<string>();
	const itemKeys = new Set<string>();
	let operationCount = 0;
	let skipCount = 0;
	let actionableItemCount = 0;
	let serverCount = 0;
	let kometaCount = 0;

	for (const item of payload.items) {
		if (
			!item?.target ||
			!item.selectionFrom ||
			!item.discovery ||
			!Array.isArray(item.selections) ||
			!Array.isArray(item.destinationSlots) ||
			!Array.isArray(item.operations) ||
			!Array.isArray(item.skips)
		) {
			failInvalid('Invalid frozen apply item');
		}
		const itemKey = `${item.target.serverInstanceId}:${item.target.mediaItemId}`;
		if (itemKeys.has(itemKey)) failInvalid('Duplicate frozen apply target');
		itemKeys.add(itemKey);
		if (!item.target.serverInstanceId || !Number.isInteger(item.target.mediaItemId)) {
			failInvalid('Invalid frozen apply target');
		}
		if (!/^[0-9a-f]{64}$/.test(item.sourceFingerprint)) {
			failInvalid('Invalid frozen item fingerprint');
		}
		for (const selection of item.selections) {
			if (
				!selection ||
				!validSlot(selection.slot) ||
				!selection.url ||
				selection.sourceItem.serverInstanceId !== item.selectionFrom.serverInstanceId ||
				selection.sourceItem.mediaItemId !== item.selectionFrom.mediaItemId
			) {
				failInvalid('Invalid frozen artwork selection');
			}
		}
		if (item.operations.length > 0) actionableItemCount++;
		operationCount += item.operations.length;
		skipCount += item.skips.length;

		for (const operation of item.operations) {
			if (
				!operation?.selection ||
				!operation.current ||
				typeof operation.targetId !== 'string' ||
				operation.targetId.length === 0 ||
				typeof operation.selection.url !== 'string' ||
				operation.selection.url.length === 0
			) {
				failInvalid('Invalid frozen apply operation');
			}
			if (!expectedDestinations.has(operation.destination)) {
				failInvalid('Frozen operation targets an unrequested destination');
			}
			if (!same(operation.target, item.target) || !validSlot(operation.slot)) {
				failInvalid('Frozen operation target or slot does not match its item');
			}
			if (
				operation.selection.sourceItem.serverInstanceId !== item.selectionFrom.serverInstanceId ||
				operation.selection.sourceItem.mediaItemId !== item.selectionFrom.mediaItemId ||
				applySlotKey(operation.selection.slot) !== applySlotKey(operation.slot)
			) {
				failInvalid('Frozen operation selection does not match its source or slot');
			}
			const expectedId = hashCanonicalJson({
				destination: operation.destination,
				serverInstanceId: operation.target.serverInstanceId,
				mediaItemId: operation.target.mediaItemId,
				targetId: operation.targetId,
				slot: operation.slot,
				selectionFingerprint: operation.selection.fingerprint
			});
			if (operation.id !== expectedId || operationIds.has(operation.id)) {
				failInvalid('Invalid or duplicate frozen operation identity');
			}
			operationIds.add(operation.id);
			if (operation.destination === 'server') serverCount++;
			else kometaCount++;
		}

		const selectionFingerprint = hashCanonicalJson({
			selectionUpdatedAt: item.selectionFrom.selectionUpdatedAt,
			discoveryFingerprint: item.discovery.fingerprint,
			selections: item.selections
		});
		const currentStateFingerprint = hashCanonicalJson({
			targetUpdatedAt: item.target.updatedAt,
			destinationSlots: item.destinationSlots.map((snapshot) => ({
				destination: snapshot.destination,
				slot: snapshot.slot,
				targetId: snapshot.targetId,
				capability: snapshot.capability,
				current: snapshot.current,
				skipCode: snapshot.skipCode
			}))
		});
		const sourceFingerprint = hashCanonicalJson({
			target: item.target,
			selectionFrom: item.selectionFrom,
			selectionFingerprint,
			currentStateFingerprint,
			operations: item.operations.map((operation) => operation.id),
			skips: item.skips
		});
		if (
			item.selectionFingerprint !== selectionFingerprint ||
			item.currentStateFingerprint !== currentStateFingerprint ||
			item.sourceFingerprint !== sourceFingerprint
		) {
			failInvalid('Frozen apply item fingerprints are inconsistent');
		}
	}
	assertCrossServerContext(payload);
	assertCollectionContext(payload);

	const serverInstanceIds = sortedUnique(payload.items.map((item) => item.target.serverInstanceId));
	const librarySectionKeys = sortedUnique(
		payload.items.map((item) => item.target.librarySectionKey)
	);
	const targetItemIds = payload.items.map((item) => item.target.mediaItemId);
	if (
		!same(payload.scope.serverInstanceIds, serverInstanceIds) ||
		!same(payload.scope.librarySectionKeys, librarySectionKeys) ||
		!same(payload.scope.targetItemIds, targetItemIds)
	) {
		failInvalid('Frozen apply scope does not match its items');
	}
	if (
		payload.summary.itemCount !== payload.items.length ||
		payload.summary.actionableItemCount !== actionableItemCount ||
		payload.summary.operationCount !== operationCount ||
		payload.summary.skipCount !== skipCount ||
		payload.summary.destinations.server !== serverCount ||
		payload.summary.destinations.kometa !== kometaCount
	) {
		failInvalid('Frozen apply summary does not match its operations');
	}
	const expectedSourceFingerprint = hashCanonicalJson({
		context: payload.context,
		defaults: payload.defaults,
		items: payload.items.map((item) => item.sourceFingerprint)
	});
	if (payload.sourceFingerprint !== expectedSourceFingerprint) {
		failInvalid('Frozen apply source fingerprint is invalid');
	}
}

function ref(identity: { serverInstanceId: string; mediaItemId: number }): ApplyItemRef {
	return {
		serverInstanceId: identity.serverInstanceId,
		mediaItemId: identity.mediaItemId
	};
}

function selectionKey(selection: FrozenArtworkSelection): string {
	return `${applySlotKey(selection.slot)}:${selection.fingerprint}`;
}

function sortedDestinations(
	rows: import('./apply-plan').DestinationSlotSnapshot[]
): import('./apply-plan').DestinationSlotSnapshot[] {
	return [...rows].sort((a, b) => {
		const destination = a.destination.localeCompare(b.destination);
		if (destination !== 0) return destination;
		const season = (a.slot.season ?? -1) - (b.slot.season ?? -1);
		if (season !== 0) return season;
		const episode = (a.slot.episode ?? -1) - (b.slot.episode ?? -1);
		if (episode !== 0) return episode;
		return (
			a.slot.kind.localeCompare(b.slot.kind) || (a.targetId ?? '').localeCompare(b.targetId ?? '')
		);
	});
}

function currentSelection(
	planned: FrozenArtworkSelection,
	data: ApplyPlannerItemData
): FrozenArtworkSelection | null {
	if (planned.selectionSource === 'auto') {
		const candidate = data.candidates.find(
			(row) =>
				row.candidateId === planned.candidateId &&
				row.active &&
				row.url === planned.url &&
				applySlotKey(row.slot) === applySlotKey(planned.slot)
		);
		return candidate
			? freezeApplyCandidateSelection(candidate, 'auto', data.item.identity, planned.score)
			: null;
	}

	const stored = data.storedSelections.find(
		(row) => row.url === planned.url && applySlotKey(row.slot) === applySlotKey(planned.slot)
	);
	return stored ? freezeApplyStoredSelection(stored, data) : null;
}

/**
 * Re-read only state identities needed to prove the frozen plan is still current.
 * This never performs discovery or automatic selection and never changes staging.
 */
export async function assertApplyPlanFresh(
	payload: ApplyPlanPayloadV1,
	dependencies: ApplyPlanFreshnessResolverDependencies
): Promise<void> {
	assertApplyPlanPayload(payload);
	await dependencies.validateContext?.(payload);
	const cache = new Map<string, Promise<ApplyPlannerItemData | null>>();
	const load = (identity: { serverInstanceId: string; mediaItemId: number }) => {
		const key = `${identity.serverInstanceId}:${identity.mediaItemId}`;
		let pending = cache.get(key);
		if (!pending) {
			pending = dependencies.loadItemData(ref(identity));
			cache.set(key, pending);
		}
		return pending;
	};

	for (const plannedItem of payload.items) {
		const [target, selectionFrom] = await Promise.all([
			load(plannedItem.target),
			load(plannedItem.selectionFrom)
		]);
		if (!target || !selectionFrom) failStale('A frozen apply item is no longer available');
		if (
			!same(target.item.identity, plannedItem.target) ||
			!same(selectionFrom.item.identity, plannedItem.selectionFrom)
		) {
			failStale('A frozen apply item or pending selection changed');
		}

		const plannedIgnored = plannedItem.skips.some(
			(skip) => skip.destination === null && skip.code === 'item_ignored'
		);
		const plannedRemoved = plannedItem.skips.some(
			(skip) => skip.destination === null && skip.code === 'item_removed'
		);
		if (
			(target.item.ignored || selectionFrom.item.ignored) !== plannedIgnored ||
			(target.item.sourceRemoved || selectionFrom.item.sourceRemoved) !== plannedRemoved
		) {
			failStale('Frozen apply eligibility changed');
		}
		if (!same(freezeApplyDiscoverySnapshot(selectionFrom), plannedItem.discovery)) {
			failStale('Frozen artwork candidates changed');
		}

		const selections = plannedItem.selections;
		for (const plannedSelection of selections) {
			const current = currentSelection(plannedSelection, selectionFrom);
			if (!current || current.fingerprint !== plannedSelection.fingerprint) {
				failStale('A frozen artwork selection changed');
			}
		}
		if (payload.defaults.selectionMode === 'stored') {
			const currentStored = selectionFrom.storedSelections
				.map((selection) => freezeApplyStoredSelection(selection, selectionFrom))
				.sort((a, b) => selectionKey(a).localeCompare(selectionKey(b)));
			const plannedStored = [...selections].sort((a, b) =>
				selectionKey(a).localeCompare(selectionKey(b))
			);
			if (!same(currentStored, plannedStored)) {
				failStale('Frozen pending artwork selections changed');
			}
		}

		const itemSkipped = plannedIgnored || plannedRemoved;
		const destinations =
			payload.defaults.effectiveMethod === 'both'
				? (['server', 'kometa'] as const)
				: [payload.defaults.effectiveMethod];
		const snapshots =
			itemSkipped || selections.length === 0
				? []
				: await dependencies.resolveDestinationSlots({
						context: payload.context,
						target,
						selectionFrom,
						selections,
						destinations: [...destinations]
					});
		if (!same(sortedDestinations(snapshots), plannedItem.destinationSlots)) {
			failStale('Frozen apply destination snapshots changed');
		}
		for (const operation of plannedItem.operations) {
			const snapshot = snapshots.find(
				(row) =>
					row.destination === operation.destination &&
					applySlotKey(row.slot) === applySlotKey(operation.slot)
			);
			if (
				!snapshot ||
				snapshot.targetId !== operation.targetId ||
				snapshot.capability !== 'supported' ||
				snapshot.skipCode !== null ||
				!same(snapshot.current, operation.current)
			) {
				failStale('A frozen apply destination changed');
			}
		}
	}
	await dependencies.validateContext?.(payload);
}

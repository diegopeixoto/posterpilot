import { hashCanonicalJson } from './canonical-json';

export const APPLY_PLAN_KIND = 'artwork_apply';
export const APPLY_PLAN_VERSION = 1 as const;

export type ApplyPlanSource = 'single' | 'bulk' | 'review' | 'collection' | 'cross_server';
export type ApplySelectionMode = 'auto' | 'stored';
export type ApplyPlanMethod = 'server' | 'kometa' | 'both';
export type ApplyPlanDestination = 'server' | 'kometa';
export type ApplySlotKind = 'poster' | 'background' | 'title_card';

export interface ApplySlot {
	kind: ApplySlotKind;
	season: number | null;
	episode: number | null;
}

export interface ApplyItemIdentity {
	serverInstanceId: string;
	mediaItemId: number;
	librarySectionKey: string;
	sourceId: string;
	type: 'movie' | 'show';
	tmdbId: string | null;
	imdbId: string | null;
	tvdbId: string | null;
	mediaType: 'movie' | 'tv' | null;
	updatedAt: string | null;
	selectionUpdatedAt: string | null;
}

export type ExactExternalMatch =
	| { namespace: 'tmdb'; value: string }
	| { namespace: 'imdb'; value: string }
	| { namespace: 'tvdb'; value: string };

export type CrossServerMatchStatus =
	| 'matched'
	| 'not_found'
	| 'ambiguous'
	| 'server_not_found'
	| 'server_disabled';

/** Frozen identifier-only resolution; titles never participate in cross-server matching. */
export interface CrossServerMatchResolution {
	serverInstanceId: string;
	status: CrossServerMatchStatus;
	/** Empty for skips, one id for a match, and every exact collision for ambiguity. */
	candidateItemIds: number[];
}

export type FrozenApplyContext =
	| { source: 'single' }
	| { source: 'bulk'; resultSetFingerprint: string | null }
	| {
			source: 'review';
			reviewViewId: string | null;
			reviewContextFingerprint: string | null;
	  }
	| { source: 'collection'; collectionId: string; membershipFingerprint: string | null }
	| {
			source: 'cross_server';
			sourceItem: ApplyItemIdentity;
			match: ExactExternalMatch;
			destinationServerInstanceIds: string[];
			resolutions: CrossServerMatchResolution[];
	  };

export interface FrozenScoringDefaults {
	providerPriority: string[];
	weights: {
		providerWeights: Record<string, number>;
		resolutionWeight: number;
		aspectWeight: number;
	};
}

export interface FrozenApplyDefaults {
	configuredMethod: ApplyPlanMethod;
	effectiveMethod: ApplyPlanMethod;
	methodSource: 'explicit' | 'configured_default';
	selectionMode: ApplySelectionMode;
	scoring: FrozenScoringDefaults;
}

export interface FrozenDiscoverySnapshot {
	status: string;
	runId: string | null;
	completedAt: string | null;
	resolvedTmdbId: string | null;
	resolvedMediaType: 'movie' | 'tv' | null;
	candidateIds: number[];
	candidateCount: number;
	fingerprint: string;
}

export interface FrozenArtworkSelection {
	selectionSource: ApplySelectionMode;
	sourceItem: {
		serverInstanceId: string;
		mediaItemId: number;
	};
	slot: ApplySlot;
	candidateId: number | null;
	url: string;
	provider: string | null;
	providerAssetId: string | null;
	setId: string | null;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	discoveryRunId: string | null;
	resolvedTmdbId: string | null;
	resolvedMediaType: 'movie' | 'tv' | null;
	stale: boolean;
	score: number | null;
	width: number | null;
	height: number | null;
	fingerprint: string;
}

export interface CurrentArtworkIdentity {
	url: string | null;
	fingerprint: string | null;
	artworkVersion: number | null;
	observedAt: string | null;
	destinationFingerprint: string | null;
}

export type ApplyPlanSkipCode =
	| 'item_ignored'
	| 'item_removed'
	| 'no_candidate'
	| 'no_stored_selection'
	| 'invalid_selection'
	| 'destination_unavailable'
	| 'unsupported_slot'
	| 'missing_tmdb_id'
	| 'target_unresolved'
	| 'capability_unknown';

export interface DestinationSlotSnapshot {
	destination: ApplyPlanDestination;
	slot: ApplySlot;
	targetId: string | null;
	capability: 'supported' | 'unsupported' | 'unknown';
	current: CurrentArtworkIdentity;
	skipCode: ApplyPlanSkipCode | null;
	parameters: Record<string, string | number | boolean | null>;
}

export interface ApplyPlanOperation {
	id: string;
	destination: ApplyPlanDestination;
	target: ApplyItemIdentity;
	targetId: string;
	slot: ApplySlot;
	current: CurrentArtworkIdentity;
	selection: FrozenArtworkSelection;
	expectedOverwrite: boolean;
}

export interface ApplyPlanSkip {
	destination: ApplyPlanDestination | null;
	slot: ApplySlot | null;
	code: ApplyPlanSkipCode;
	parameters: Record<string, string | number | boolean | null>;
}

export interface ApplyPlanItem {
	target: ApplyItemIdentity;
	selectionFrom: ApplyItemIdentity;
	discovery: FrozenDiscoverySnapshot;
	/** Every frozen proposal, including selections whose destinations are skipped. */
	selections: FrozenArtworkSelection[];
	/** Every resolved destination identity/capability used to derive operations/skips. */
	destinationSlots: DestinationSlotSnapshot[];
	operations: ApplyPlanOperation[];
	skips: ApplyPlanSkip[];
	selectionFingerprint: string;
	currentStateFingerprint: string;
	sourceFingerprint: string;
}

export interface ApplyPlanSummary {
	itemCount: number;
	actionableItemCount: number;
	operationCount: number;
	skipCount: number;
	destinations: {
		server: number;
		kometa: number;
	};
}

export interface ApplyPlanPayloadV1 {
	version: typeof APPLY_PLAN_VERSION;
	type: typeof APPLY_PLAN_KIND;
	plannedAt: string;
	context: FrozenApplyContext;
	defaults: FrozenApplyDefaults;
	scope: {
		serverInstanceIds: string[];
		librarySectionKeys: string[];
		targetItemIds: number[];
	};
	items: ApplyPlanItem[];
	sourceFingerprint: string;
	summary: ApplyPlanSummary;
}

/** Immutable queue payload produced only after a plan is atomically consumed. */
export interface FrozenApplyJobPayload {
	kind: 'apply';
	planId: string;
	digest: string;
	plan: ApplyPlanPayloadV1;
}

export interface BuildApplyPlanItemInput {
	target: ApplyItemIdentity;
	selectionFrom: ApplyItemIdentity;
	discovery: FrozenDiscoverySnapshot;
	selections: FrozenArtworkSelection[];
	destinationSlots: DestinationSlotSnapshot[];
	itemSkip: 'item_ignored' | 'item_removed' | null;
}

export interface BuildApplyPlanInput {
	plannedAt: string;
	context: FrozenApplyContext;
	defaults: FrozenApplyDefaults;
	items: BuildApplyPlanItemInput[];
}

export function applySlotKey(slot: ApplySlot): string {
	return `${slot.kind}:${slot.season ?? 'root'}:${slot.episode ?? 'root'}`;
}

function destinationSlotKey(destination: ApplyPlanDestination, slot: ApplySlot): string {
	return `${destination}:${applySlotKey(slot)}`;
}

function compareSlots(a: ApplySlot, b: ApplySlot): number {
	const season = (a.season ?? -1) - (b.season ?? -1);
	if (season !== 0) return season;
	const episode = (a.episode ?? -1) - (b.episode ?? -1);
	if (episode !== 0) return episode;
	return a.kind.localeCompare(b.kind);
}

function compareSelections(a: FrozenArtworkSelection, b: FrozenArtworkSelection): number {
	return compareSlots(a.slot, b.slot) || a.fingerprint.localeCompare(b.fingerprint);
}

function compareDestinationSlots(a: DestinationSlotSnapshot, b: DestinationSlotSnapshot): number {
	return (
		a.destination.localeCompare(b.destination) ||
		compareSlots(a.slot, b.slot) ||
		(a.targetId ?? '').localeCompare(b.targetId ?? '')
	);
}

function compareOperations(a: ApplyPlanOperation, b: ApplyPlanOperation): number {
	return (
		a.destination.localeCompare(b.destination) ||
		compareSlots(a.slot, b.slot) ||
		a.targetId.localeCompare(b.targetId)
	);
}

function compareSkips(a: ApplyPlanSkip, b: ApplyPlanSkip): number {
	return (
		(a.destination ?? '').localeCompare(b.destination ?? '') ||
		(a.slot && b.slot ? compareSlots(a.slot, b.slot) : a.slot ? 1 : b.slot ? -1 : 0) ||
		a.code.localeCompare(b.code)
	);
}

function requestedDestinations(method: ApplyPlanMethod): ApplyPlanDestination[] {
	if (method === 'both') return ['kometa', 'server'];
	return [method];
}

function skipForDestinationSnapshot(snapshot: DestinationSlotSnapshot): ApplyPlanSkipCode | null {
	if (snapshot.skipCode) return snapshot.skipCode;
	if (snapshot.capability === 'unsupported') return 'unsupported_slot';
	if (snapshot.capability === 'unknown') return 'capability_unknown';
	if (!snapshot.targetId) return 'target_unresolved';
	return null;
}

function buildItem(
	input: BuildApplyPlanItemInput,
	method: ApplyPlanMethod,
	selectionMode: ApplySelectionMode
): ApplyPlanItem {
	const destinations = requestedDestinations(method);
	const selections = [...input.selections].sort(compareSelections);
	const selectionKeys = new Set<string>();
	for (const selection of selections) {
		const key = applySlotKey(selection.slot);
		if (selectionKeys.has(key)) throw new TypeError(`Duplicate apply selection slot: ${key}`);
		selectionKeys.add(key);
	}

	const snapshots = [...input.destinationSlots].sort(compareDestinationSlots);
	const snapshotByKey = new Map<string, DestinationSlotSnapshot>();
	for (const snapshot of snapshots) {
		const key = destinationSlotKey(snapshot.destination, snapshot.slot);
		if (snapshotByKey.has(key)) throw new TypeError(`Duplicate destination slot snapshot: ${key}`);
		snapshotByKey.set(key, snapshot);
	}

	const operations: ApplyPlanOperation[] = [];
	const skips: ApplyPlanSkip[] = [];

	if (input.itemSkip) {
		skips.push({ destination: null, slot: null, code: input.itemSkip, parameters: {} });
	} else {
		for (const rootSlot of [
			{ kind: 'poster', season: null, episode: null },
			{ kind: 'background', season: null, episode: null }
		] satisfies ApplySlot[]) {
			if (selectionKeys.has(applySlotKey(rootSlot))) continue;
			for (const destination of destinations) {
				skips.push({
					destination,
					slot: rootSlot,
					code: selectionMode === 'auto' ? 'no_candidate' : 'no_stored_selection',
					parameters: {}
				});
			}
		}

		for (const selection of selections) {
			for (const destination of destinations) {
				if (
					destination === 'kometa' &&
					selection.slot.kind === 'background' &&
					selection.slot.season !== null
				) {
					skips.push({
						destination,
						slot: selection.slot,
						code: 'unsupported_slot',
						parameters: { destination: 'kometa' }
					});
					continue;
				}
				if (destination === 'kometa' && input.target.tmdbId === null) {
					skips.push({
						destination,
						slot: selection.slot,
						code: 'missing_tmdb_id',
						parameters: {}
					});
					continue;
				}

				const snapshot = snapshotByKey.get(destinationSlotKey(destination, selection.slot));
				if (!snapshot) {
					skips.push({
						destination,
						slot: selection.slot,
						code: 'target_unresolved',
						parameters: {}
					});
					continue;
				}
				const skipCode = skipForDestinationSnapshot(snapshot);
				if (skipCode || snapshot.targetId === null) {
					skips.push({
						destination,
						slot: selection.slot,
						code: skipCode ?? 'target_unresolved',
						parameters: snapshot.parameters
					});
					continue;
				}

				const operationIdentity = {
					destination,
					serverInstanceId: input.target.serverInstanceId,
					mediaItemId: input.target.mediaItemId,
					targetId: snapshot.targetId,
					slot: selection.slot,
					selectionFingerprint: selection.fingerprint
				};
				operations.push({
					id: hashCanonicalJson(operationIdentity),
					destination,
					target: input.target,
					targetId: snapshot.targetId,
					slot: selection.slot,
					current: snapshot.current,
					selection,
					expectedOverwrite: snapshot.current.url !== null || snapshot.current.fingerprint !== null
				});
			}
		}
	}

	operations.sort(compareOperations);
	skips.sort(compareSkips);
	const selectionFingerprint = hashCanonicalJson({
		selectionUpdatedAt: input.selectionFrom.selectionUpdatedAt,
		discoveryFingerprint: input.discovery.fingerprint,
		selections
	});
	const currentStateFingerprint = hashCanonicalJson({
		targetUpdatedAt: input.target.updatedAt,
		destinationSlots: snapshots.map((snapshot) => ({
			destination: snapshot.destination,
			slot: snapshot.slot,
			targetId: snapshot.targetId,
			capability: snapshot.capability,
			current: snapshot.current,
			skipCode: snapshot.skipCode
		}))
	});
	const sourceFingerprint = hashCanonicalJson({
		target: input.target,
		selectionFrom: input.selectionFrom,
		selectionFingerprint,
		currentStateFingerprint,
		operations: operations.map((operation) => operation.id),
		skips
	});

	return {
		target: input.target,
		selectionFrom: input.selectionFrom,
		discovery: input.discovery,
		selections,
		destinationSlots: snapshots,
		operations,
		skips,
		selectionFingerprint,
		currentStateFingerprint,
		sourceFingerprint
	};
}

/** Build the exact, deterministic payload later consumed by the apply executor. */
export function buildApplyPlanPayload(input: BuildApplyPlanInput): ApplyPlanPayloadV1 {
	const items = [...input.items]
		.sort(
			(a, b) =>
				a.target.serverInstanceId.localeCompare(b.target.serverInstanceId) ||
				a.target.mediaItemId - b.target.mediaItemId
		)
		.map((item) => buildItem(item, input.defaults.effectiveMethod, input.defaults.selectionMode));

	const serverInstanceIds = [...new Set(items.map((item) => item.target.serverInstanceId))].sort();
	const librarySectionKeys = [
		...new Set(items.map((item) => item.target.librarySectionKey))
	].sort();
	const targetItemIds = items.map((item) => item.target.mediaItemId);
	const operationCount = items.reduce((count, item) => count + item.operations.length, 0);
	const skipCount = items.reduce((count, item) => count + item.skips.length, 0);
	const summary: ApplyPlanSummary = {
		itemCount: items.length,
		actionableItemCount: items.filter((item) => item.operations.length > 0).length,
		operationCount,
		skipCount,
		destinations: {
			server: items.reduce(
				(count, item) =>
					count + item.operations.filter((operation) => operation.destination === 'server').length,
				0
			),
			kometa: items.reduce(
				(count, item) =>
					count + item.operations.filter((operation) => operation.destination === 'kometa').length,
				0
			)
		}
	};
	const sourceFingerprint = hashCanonicalJson({
		context: input.context,
		defaults: input.defaults,
		items: items.map((item) => item.sourceFingerprint)
	});

	return {
		version: APPLY_PLAN_VERSION,
		type: APPLY_PLAN_KIND,
		plannedAt: input.plannedAt,
		context: input.context,
		defaults: input.defaults,
		scope: { serverInstanceIds, librarySectionKeys, targetItemIds },
		items,
		sourceFingerprint,
		summary
	};
}

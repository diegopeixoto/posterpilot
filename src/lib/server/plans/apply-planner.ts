import { hashCanonicalJson } from './canonical-json';
import {
	APPLY_PLAN_KIND,
	buildApplyPlanPayload,
	applySlotKey,
	type ApplyItemIdentity,
	type ApplyPlanDestination,
	type ApplyPlanMethod,
	type ApplyPlanPayloadV1,
	type ApplySelectionMode,
	type ApplySlot,
	type BuildApplyPlanItemInput,
	type CrossServerMatchResolution,
	type DestinationSlotSnapshot,
	type ExactExternalMatch,
	type FrozenApplyContext,
	type FrozenApplyDefaults,
	type FrozenArtworkSelection,
	type FrozenDiscoverySnapshot
} from './apply-plan';
import type { CreateOperationPlanInput, OperationPlan } from './operation-plan-store';
import type {
	AutomaticArtworkSelection,
	AutomaticSelectionInputs
} from '$lib/server/posters/automatic-selection';
import type { ScoreWeights } from '$lib/server/posters/score';

export type ApplyMethodInput = ApplyPlanMethod | 'plex';

export interface ApplyItemRef {
	serverInstanceId: string;
	mediaItemId: number;
}

export type ApplyPlanContextRequest =
	| { source: 'single' }
	| { source: 'bulk'; resultSetFingerprint?: string | null }
	| {
			source: 'review';
			reviewViewId?: string | null;
			reviewContextFingerprint?: string | null;
	  }
	| { source: 'collection'; collectionId: string; membershipFingerprint?: string | null }
	| {
			source: 'cross_server';
			sourceItem: ApplyItemRef;
			match: ExactExternalMatch;
			/** Explicit requested destinations, including unmatched/ambiguous skips. */
			destinationServerInstanceIds?: string[];
			/** Server-resolved exact-identifier decisions; never accept these from a browser directly. */
			resolutions?: CrossServerMatchResolution[];
	  };

export interface ApplyPlanTargetRequest extends ApplyItemRef {
	/** Defaults to the target itself, except cross-server plans which use the context source. */
	selectionFrom?: ApplyItemRef;
}

export interface PlanArtworkApplyRequest {
	context: ApplyPlanContextRequest;
	targets: ApplyPlanTargetRequest[];
	selectionMode: ApplySelectionMode;
	method?: ApplyMethodInput;
	ttlMs?: number;
}

export interface ApplyPlannerDefaults {
	defaultMethod: ApplyMethodInput;
	providerPriority: readonly string[];
	scoreWeights: ScoreWeights;
}

export interface PlannerCandidateSnapshot {
	candidateId: number;
	serverInstanceId: string;
	mediaItemId: number;
	discoveryRunId: string | null;
	provider: string;
	providerAssetId: string | null;
	setId: string;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	url: string;
	slot: ApplySlot;
	resolvedTmdbId: string | null;
	resolvedMediaType: 'movie' | 'tv' | null;
	width: number | null;
	height: number | null;
	score: number | null;
	active: boolean;
	stale: boolean;
	lastSeenAt: string | null;
}

export interface PlannerStoredSelection {
	slot: ApplySlot;
	candidateId: number | null;
	url: string;
	provider: string | null;
	setId: string | null;
	setAuthor: string | null;
}

export interface PlannerCurrentSlotState {
	slot: ApplySlot;
	url: string | null;
	fingerprint: string | null;
	artworkVersion: number | null;
	observedAt: string | null;
}

export interface ApplyPlannerItemSnapshot {
	identity: ApplyItemIdentity;
	ignored: boolean;
	sourceRemoved: boolean;
	discovery: {
		status: string;
		runId: string | null;
		completedAt: string | null;
	};
	currentSlots: PlannerCurrentSlotState[];
}

export interface ApplyPlannerItemData {
	item: ApplyPlannerItemSnapshot;
	candidates: PlannerCandidateSnapshot[];
	storedSelections: PlannerStoredSelection[];
}

export interface ResolveApplyDestinationsInput {
	context: FrozenApplyContext;
	target: ApplyPlannerItemData;
	selectionFrom: ApplyPlannerItemData;
	selections: FrozenArtworkSelection[];
	destinations: ApplyPlanDestination[];
}

export interface ApplyPlannerDependencies {
	loadItemData(ref: ApplyItemRef): Promise<ApplyPlannerItemData | null>;
	loadDefaults(): Promise<ApplyPlannerDefaults>;
	selectAutomatic(
		ref: ApplyItemRef,
		inputs: AutomaticSelectionInputs
	): Promise<AutomaticArtworkSelection>;
	resolveDestinationSlots(input: ResolveApplyDestinationsInput): Promise<DestinationSlotSnapshot[]>;
	persistPlan(
		input: CreateOperationPlanInput<ApplyPlanPayloadV1>
	): Promise<OperationPlan<ApplyPlanPayloadV1>>;
	clock?: () => Date;
}

export interface ApplyPlanPreview {
	payload: ApplyPlanPayloadV1;
	/** Empty previews are intentionally not confirmation-bearing plans. */
	plan: OperationPlan<ApplyPlanPayloadV1> | null;
}

export type ApplyPlannerErrorCode =
	| 'invalid_request'
	| 'duplicate_target'
	| 'item_not_found'
	| 'scope_mismatch'
	| 'external_identity_mismatch'
	| 'automatic_selection_changed'
	| 'invalid_defaults'
	| 'invalid_destination_snapshot';

export class ApplyPlannerError extends Error {
	constructor(
		readonly code: ApplyPlannerErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ApplyPlannerError';
	}
}

function refKey(ref: ApplyItemRef): string {
	return `${ref.serverInstanceId}:${ref.mediaItemId}`;
}

function sameRef(a: ApplyItemRef, b: ApplyItemRef): boolean {
	return a.serverInstanceId === b.serverInstanceId && a.mediaItemId === b.mediaItemId;
}

function assertRef(ref: ApplyItemRef): void {
	if (
		!ref ||
		typeof ref.serverInstanceId !== 'string' ||
		!ref.serverInstanceId.trim() ||
		ref.serverInstanceId.trim() !== ref.serverInstanceId ||
		!Number.isInteger(ref.mediaItemId) ||
		ref.mediaItemId <= 0
	) {
		throw new ApplyPlannerError('invalid_request', 'Apply item references require a server and id');
	}
}

function assertServerInstanceId(serverInstanceId: string): void {
	if (
		typeof serverInstanceId !== 'string' ||
		!serverInstanceId.trim() ||
		serverInstanceId.trim() !== serverInstanceId
	) {
		throw new ApplyPlannerError('invalid_request', 'Server instance ids must be explicit');
	}
}

function crossDestinationServerIds(
	context: Extract<ApplyPlanContextRequest, { source: 'cross_server' }>,
	targets: ApplyPlanTargetRequest[]
): string[] {
	const requested =
		context.destinationServerInstanceIds ?? targets.map((target) => target.serverInstanceId);
	for (const serverInstanceId of requested) assertServerInstanceId(serverInstanceId);
	return [...requested].sort();
}

function crossResolutions(
	context: Extract<ApplyPlanContextRequest, { source: 'cross_server' }>,
	targets: ApplyPlanTargetRequest[]
): CrossServerMatchResolution[] {
	const supplied =
		context.resolutions ??
		targets.map((target) => ({
			serverInstanceId: target.serverInstanceId,
			status: 'matched' as const,
			candidateItemIds: [target.mediaItemId]
		}));
	return supplied
		.map((resolution) => ({
			serverInstanceId: resolution.serverInstanceId,
			status: resolution.status,
			candidateItemIds: [...resolution.candidateItemIds].sort((a, b) => a - b)
		}))
		.sort((a, b) => a.serverInstanceId.localeCompare(b.serverInstanceId));
}

function validSlot(slot: ApplySlot): boolean {
	const validSeason = slot.season === null || (Number.isInteger(slot.season) && slot.season >= 0);
	const validEpisode =
		slot.episode === null || (Number.isInteger(slot.episode) && slot.episode >= 0);
	if (!validSeason || !validEpisode) return false;
	if (slot.kind === 'title_card') return slot.season !== null && slot.episode !== null;
	return slot.episode === null;
}

function normalizeMethod(method: ApplyMethodInput): ApplyPlanMethod {
	if (method === 'plex') return 'server';
	if (method === 'server' || method === 'kometa' || method === 'both') return method;
	throw new ApplyPlannerError('invalid_defaults', 'Unsupported apply method');
}

function destinationsForMethod(method: ApplyPlanMethod): ApplyPlanDestination[] {
	if (method === 'both') return ['server', 'kometa'];
	return [method];
}

function validateFiniteWeight(value: number): void {
	if (!Number.isFinite(value)) {
		throw new ApplyPlannerError('invalid_defaults', 'Artwork score weights must be finite');
	}
}

function freezeDefaults(
	defaults: ApplyPlannerDefaults,
	request: PlanArtworkApplyRequest
): FrozenApplyDefaults {
	const providerPriority = [...defaults.providerPriority];
	if (
		providerPriority.some((provider) => !provider.trim() || provider.trim() !== provider) ||
		new Set(providerPriority).size !== providerPriority.length
	) {
		throw new ApplyPlannerError(
			'invalid_defaults',
			'Provider priority must contain unique non-empty ids'
		);
	}
	for (const weight of Object.values(defaults.scoreWeights.providerWeights)) {
		validateFiniteWeight(weight);
	}
	validateFiniteWeight(defaults.scoreWeights.resolutionWeight);
	validateFiniteWeight(defaults.scoreWeights.aspectWeight);

	const configuredMethod = normalizeMethod(defaults.defaultMethod);
	const effectiveMethod = request.method ? normalizeMethod(request.method) : configuredMethod;
	return {
		configuredMethod,
		effectiveMethod,
		methodSource: request.method ? 'explicit' : 'configured_default',
		selectionMode: request.selectionMode,
		scoring: {
			providerPriority,
			weights: {
				providerWeights: { ...defaults.scoreWeights.providerWeights },
				resolutionWeight: defaults.scoreWeights.resolutionWeight,
				aspectWeight: defaults.scoreWeights.aspectWeight
			}
		}
	};
}

function externalIdentity(item: ApplyItemIdentity, match: ExactExternalMatch): string | null {
	if (match.namespace === 'tmdb') return item.tmdbId;
	if (match.namespace === 'imdb') return item.imdbId;
	return item.tvdbId;
}

function validateLoadedItem(ref: ApplyItemRef, data: ApplyPlannerItemData): void {
	if (
		data.item.identity.serverInstanceId !== ref.serverInstanceId ||
		data.item.identity.mediaItemId !== ref.mediaItemId
	) {
		throw new ApplyPlannerError('scope_mismatch', 'Loaded item does not match requested scope');
	}
	const candidateIds = new Set<number>();
	for (const candidate of data.candidates) {
		if (
			candidate.serverInstanceId !== ref.serverInstanceId ||
			candidate.mediaItemId !== ref.mediaItemId
		) {
			throw new ApplyPlannerError(
				'scope_mismatch',
				'Candidate does not belong to the requested item scope'
			);
		}
		if (
			!Number.isInteger(candidate.candidateId) ||
			candidate.candidateId <= 0 ||
			candidateIds.has(candidate.candidateId) ||
			!candidate.url ||
			!validSlot(candidate.slot)
		) {
			throw new ApplyPlannerError('invalid_request', 'Invalid candidate snapshot');
		}
		candidateIds.add(candidate.candidateId);
	}
	for (const selection of data.storedSelections) {
		if (!selection.url || !validSlot(selection.slot)) {
			throw new ApplyPlannerError('invalid_request', 'Invalid stored artwork selection');
		}
	}
}

function candidateComparable(candidate: PlannerCandidateSnapshot) {
	return {
		candidateId: candidate.candidateId,
		serverInstanceId: candidate.serverInstanceId,
		mediaItemId: candidate.mediaItemId,
		discoveryRunId: candidate.discoveryRunId,
		provider: candidate.provider,
		providerAssetId: candidate.providerAssetId,
		setId: candidate.setId,
		setAuthor: candidate.setAuthor,
		designFamily: candidate.designFamily,
		language: candidate.language,
		url: candidate.url,
		slot: candidate.slot,
		resolvedTmdbId: candidate.resolvedTmdbId,
		resolvedMediaType: candidate.resolvedMediaType,
		width: candidate.width,
		height: candidate.height,
		score: candidate.score,
		active: candidate.active,
		stale: candidate.stale,
		lastSeenAt: candidate.lastSeenAt
	};
}

export function freezeApplyDiscoverySnapshot(data: ApplyPlannerItemData): FrozenDiscoverySnapshot {
	const candidates = [...data.candidates]
		.sort((a, b) => a.candidateId - b.candidateId)
		.map(candidateComparable);
	const active = candidates.filter((candidate) => candidate.active);
	return {
		status: data.item.discovery.status,
		runId: data.item.discovery.runId,
		completedAt: data.item.discovery.completedAt,
		resolvedTmdbId: data.item.identity.tmdbId,
		resolvedMediaType: data.item.identity.mediaType,
		candidateIds: active.map((candidate) => candidate.candidateId),
		candidateCount: active.length,
		fingerprint: hashCanonicalJson({
			status: data.item.discovery.status,
			runId: data.item.discovery.runId,
			completedAt: data.item.discovery.completedAt,
			resolvedTmdbId: data.item.identity.tmdbId,
			resolvedMediaType: data.item.identity.mediaType,
			candidates
		})
	};
}

export function freezeApplyCandidateSelection(
	candidate: PlannerCandidateSnapshot,
	selectionSource: ApplySelectionMode,
	sourceItem: ApplyItemIdentity,
	scoreOverride?: number | null
): FrozenArtworkSelection {
	const selection = {
		selectionSource,
		sourceItem: {
			serverInstanceId: sourceItem.serverInstanceId,
			mediaItemId: sourceItem.mediaItemId
		},
		slot: candidate.slot,
		candidateId: candidate.candidateId,
		url: candidate.url,
		provider: candidate.provider,
		providerAssetId: candidate.providerAssetId,
		setId: candidate.setId,
		setAuthor: candidate.setAuthor,
		designFamily: candidate.designFamily,
		language: candidate.language,
		discoveryRunId: candidate.discoveryRunId,
		resolvedTmdbId: candidate.resolvedTmdbId,
		resolvedMediaType: candidate.resolvedMediaType,
		stale: candidate.stale,
		score: scoreOverride ?? candidate.score,
		width: candidate.width,
		height: candidate.height
	};
	return { ...selection, fingerprint: hashCanonicalJson(selection) };
}

export function freezeApplyStoredSelection(
	stored: PlannerStoredSelection,
	data: ApplyPlannerItemData
): FrozenArtworkSelection {
	const matched =
		stored.candidateId === null
			? null
			: data.candidates.find(
					(candidate) =>
						candidate.candidateId === stored.candidateId &&
						candidate.url === stored.url &&
						applySlotKey(candidate.slot) === applySlotKey(stored.slot)
				);
	if (matched) return freezeApplyCandidateSelection(matched, 'stored', data.item.identity);

	const selection = {
		selectionSource: 'stored' as const,
		sourceItem: {
			serverInstanceId: data.item.identity.serverInstanceId,
			mediaItemId: data.item.identity.mediaItemId
		},
		slot: stored.slot,
		candidateId: null,
		url: stored.url,
		provider: stored.provider,
		providerAssetId: null,
		setId: stored.setId,
		setAuthor: stored.setAuthor,
		designFamily: null,
		language: null,
		discoveryRunId: null,
		resolvedTmdbId: data.item.identity.tmdbId,
		resolvedMediaType: data.item.identity.mediaType,
		stale: false,
		score: null,
		width: null,
		height: null
	};
	return { ...selection, fingerprint: hashCanonicalJson(selection) };
}

function automaticEntries(selection: AutomaticArtworkSelection) {
	return [selection.poster, selection.background, ...selection.children].filter(
		(entry): entry is NonNullable<typeof entry> => entry !== null
	);
}

function freezeAutomaticSelections(
	selection: AutomaticArtworkSelection,
	data: ApplyPlannerItemData
): FrozenArtworkSelection[] {
	return automaticEntries(selection).map((entry) => {
		const candidate = data.candidates.find(
			(row) =>
				row.candidateId === entry.candidateId &&
				row.active &&
				row.url === entry.url &&
				row.provider === entry.provider &&
				row.setId === entry.setId &&
				applySlotKey(row.slot) === applySlotKey(entry.slot) &&
				(row.resolvedTmdbId === null ||
					data.item.identity.tmdbId === null ||
					row.resolvedTmdbId === data.item.identity.tmdbId) &&
				(row.resolvedMediaType === null ||
					data.item.identity.mediaType === null ||
					row.resolvedMediaType === data.item.identity.mediaType)
		);
		if (!candidate) {
			throw new ApplyPlannerError(
				'automatic_selection_changed',
				'Automatic selection no longer matches the frozen candidate snapshot'
			);
		}
		return freezeApplyCandidateSelection(candidate, 'auto', data.item.identity, entry.score);
	});
}

function normalizeContext(
	context: ApplyPlanContextRequest,
	sourceItem?: ApplyItemIdentity,
	targets: ApplyPlanTargetRequest[] = []
): FrozenApplyContext {
	if (context.source === 'single') return { source: 'single' };
	if (context.source === 'bulk') {
		return { source: 'bulk', resultSetFingerprint: context.resultSetFingerprint ?? null };
	}
	if (context.source === 'review') {
		return {
			source: 'review',
			reviewViewId: context.reviewViewId ?? null,
			reviewContextFingerprint: context.reviewContextFingerprint ?? null
		};
	}
	if (context.source === 'collection') {
		if (!context.collectionId.trim() || !context.membershipFingerprint?.trim()) {
			throw new ApplyPlannerError(
				'invalid_request',
				'Collection context requires an id and membership fingerprint'
			);
		}
		return {
			source: 'collection',
			collectionId: context.collectionId,
			membershipFingerprint: context.membershipFingerprint
		};
	}
	if (!sourceItem) {
		throw new ApplyPlannerError('invalid_request', 'Cross-server context requires a source item');
	}
	return {
		source: 'cross_server',
		sourceItem,
		match: context.match,
		destinationServerInstanceIds: crossDestinationServerIds(context, targets),
		resolutions: crossResolutions(context, targets)
	};
}

function validateRequestShape(request: PlanArtworkApplyRequest): void {
	if (request.selectionMode !== 'auto' && request.selectionMode !== 'stored') {
		throw new ApplyPlannerError('invalid_request', 'Unsupported selection mode');
	}
	if (
		(request.context.source === 'single' || request.context.source === 'review') &&
		request.targets.length !== 1
	) {
		throw new ApplyPlannerError(
			'invalid_request',
			`${request.context.source} apply requires exactly one target`
		);
	}
	if (request.context.source === 'cross_server') {
		assertRef(request.context.sourceItem);
		if (
			!['tmdb', 'imdb', 'tvdb'].includes(request.context.match.namespace) ||
			!request.context.match.value.trim() ||
			request.context.match.value.trim() !== request.context.match.value
		) {
			throw new ApplyPlannerError(
				'invalid_request',
				'Cross-server apply requires an exact external identity'
			);
		}
		const destinationServerInstanceIds = crossDestinationServerIds(
			request.context,
			request.targets
		);
		if (
			destinationServerInstanceIds.length === 0 ||
			new Set(destinationServerInstanceIds).size !== destinationServerInstanceIds.length ||
			destinationServerInstanceIds.includes(request.context.sourceItem.serverInstanceId)
		) {
			throw new ApplyPlannerError(
				'invalid_request',
				'Cross-server apply requires unique destination servers other than the source'
			);
		}
		const resolutions = crossResolutions(request.context, request.targets);
		if (
			resolutions.length !== destinationServerInstanceIds.length ||
			new Set(resolutions.map((resolution) => resolution.serverInstanceId)).size !==
				resolutions.length ||
			resolutions.some(
				(resolution, index) =>
					resolution.serverInstanceId !== destinationServerInstanceIds[index] ||
					!['matched', 'not_found', 'ambiguous', 'server_not_found', 'server_disabled'].includes(
						resolution.status
					) ||
					new Set(resolution.candidateItemIds).size !== resolution.candidateItemIds.length ||
					resolution.candidateItemIds.some(
						(itemId) => !Number.isSafeInteger(itemId) || itemId <= 0
					) ||
					(resolution.status === 'matched'
						? resolution.candidateItemIds.length !== 1
						: resolution.status === 'ambiguous'
							? resolution.candidateItemIds.length < 2
							: resolution.candidateItemIds.length !== 0)
			)
		) {
			throw new ApplyPlannerError('invalid_request', 'Invalid cross-server match resolutions');
		}
		const matched = new Map(
			resolutions
				.filter((resolution) => resolution.status === 'matched')
				.map((resolution) => [resolution.serverInstanceId, resolution.candidateItemIds[0]])
		);
		const sourceServerInstanceId = request.context.sourceItem.serverInstanceId;
		if (
			request.targets.length !== matched.size ||
			request.targets.some(
				(target) =>
					target.serverInstanceId === sourceServerInstanceId ||
					matched.get(target.serverInstanceId) !== target.mediaItemId
			)
		) {
			throw new ApplyPlannerError(
				'scope_mismatch',
				'Cross-server targets must equal the exact server match resolutions'
			);
		}
	}

	const seen = new Set<string>();
	for (const target of request.targets) {
		assertRef(target);
		if (target.selectionFrom) assertRef(target.selectionFrom);
		const key = refKey(target);
		if (seen.has(key)) throw new ApplyPlannerError('duplicate_target', 'Duplicate apply target');
		seen.add(key);
	}

	if (request.context.source !== 'cross_server') {
		const serverIds = new Set(request.targets.map((target) => target.serverInstanceId));
		if (serverIds.size > 1) {
			throw new ApplyPlannerError(
				'scope_mismatch',
				'Mixed-server targets require the cross-server flow'
			);
		}
		for (const target of request.targets) {
			if (target.selectionFrom && !sameRef(target, target.selectionFrom)) {
				throw new ApplyPlannerError(
					'scope_mismatch',
					'Only cross-server plans may select artwork from another item'
				);
			}
		}
	}
}

function validateExternalMatch(item: ApplyItemIdentity, match: ExactExternalMatch): void {
	if (externalIdentity(item, match) !== match.value) {
		throw new ApplyPlannerError(
			'external_identity_mismatch',
			'Cross-server items must share the explicit external identity'
		);
	}
}

function validateDestinationSnapshots(
	snapshots: DestinationSlotSnapshot[],
	destinations: ApplyPlanDestination[],
	selections: FrozenArtworkSelection[]
): void {
	const selectedSlots = new Set(selections.map((selection) => applySlotKey(selection.slot)));
	const seen = new Set<string>();
	for (const snapshot of snapshots) {
		if (!destinations.includes(snapshot.destination)) {
			throw new ApplyPlannerError(
				'invalid_destination_snapshot',
				'Destination resolver returned an unrequested destination'
			);
		}
		const key = `${snapshot.destination}:${applySlotKey(snapshot.slot)}`;
		if (
			!validSlot(snapshot.slot) ||
			!selectedSlots.has(applySlotKey(snapshot.slot)) ||
			seen.has(key) ||
			(snapshot.targetId !== null && !snapshot.targetId.trim()) ||
			(snapshot.current.artworkVersion !== null &&
				(!Number.isInteger(snapshot.current.artworkVersion) || snapshot.current.artworkVersion < 0))
		) {
			throw new ApplyPlannerError(
				'invalid_destination_snapshot',
				'Destination resolver returned an invalid slot snapshot'
			);
		}
		seen.add(key);
	}
}

/**
 * Create the single planner shared by every apply surface. Dependencies are all
 * read-only except `persistPlan`, which writes only the frozen confirmation plan.
 */
export function createApplyPlanner(dependencies: ApplyPlannerDependencies) {
	const clock = dependencies.clock ?? (() => new Date());

	return async function planArtworkApply(
		request: PlanArtworkApplyRequest
	): Promise<ApplyPlanPreview> {
		validateRequestShape(request);
		const [defaultsInput] = await Promise.all([dependencies.loadDefaults()]);
		const defaults = freezeDefaults(defaultsInput, request);
		const destinations = destinationsForMethod(defaults.effectiveMethod);
		const cache = new Map<string, Promise<ApplyPlannerItemData>>();
		const selectionCache = new Map<string, Promise<FrozenArtworkSelection[]>>();

		const load = (ref: ApplyItemRef): Promise<ApplyPlannerItemData> => {
			const key = refKey(ref);
			let pending = cache.get(key);
			if (!pending) {
				pending = dependencies.loadItemData(ref).then((data) => {
					if (!data) throw new ApplyPlannerError('item_not_found', 'Apply item was not found');
					validateLoadedItem(ref, data);
					return data;
				});
				cache.set(key, pending);
			}
			return pending;
		};

		let crossSource: ApplyPlannerItemData | undefined;
		if (request.context.source === 'cross_server') {
			crossSource = await load(request.context.sourceItem);
			validateExternalMatch(crossSource.item.identity, request.context.match);
			if (
				request.context.match.namespace === 'tmdb' &&
				crossSource.item.identity.mediaType === null
			) {
				throw new ApplyPlannerError(
					'external_identity_mismatch',
					'TMDB cross-server matching requires an unambiguous movie or TV identity'
				);
			}
		}
		const context = normalizeContext(request.context, crossSource?.item.identity, request.targets);
		const materialized: BuildApplyPlanItemInput[] = [];

		for (const targetRequest of request.targets) {
			const target = await load(targetRequest);
			if (request.context.source === 'cross_server') {
				validateExternalMatch(target.item.identity, request.context.match);
				if (
					target.item.identity.type !== crossSource?.item.identity.type ||
					(request.context.match.namespace === 'tmdb' &&
						target.item.identity.mediaType !== crossSource.item.identity.mediaType)
				) {
					throw new ApplyPlannerError(
						'external_identity_mismatch',
						'Cross-server items must share one unambiguous media identity'
					);
				}
			}
			const selectionRef =
				request.context.source === 'cross_server'
					? request.context.sourceItem
					: (targetRequest.selectionFrom ?? targetRequest);
			if (
				request.context.source === 'cross_server' &&
				targetRequest.selectionFrom &&
				!sameRef(targetRequest.selectionFrom, request.context.sourceItem)
			) {
				throw new ApplyPlannerError(
					'scope_mismatch',
					'Cross-server selections must come from the declared source item'
				);
			}
			const selectionFrom = await load(selectionRef);
			const discovery = freezeApplyDiscoverySnapshot(selectionFrom);
			const itemSkip =
				target.item.ignored || selectionFrom.item.ignored
					? ('item_ignored' as const)
					: target.item.sourceRemoved || selectionFrom.item.sourceRemoved
						? ('item_removed' as const)
						: null;
			let selections: FrozenArtworkSelection[] = [];
			if (!itemSkip) {
				const selectionCacheKey = `${request.selectionMode}:${refKey(selectionRef)}`;
				let pendingSelections = selectionCache.get(selectionCacheKey);
				if (!pendingSelections) {
					pendingSelections = (async () => {
						if (request.selectionMode === 'auto') {
							const automatic = await dependencies.selectAutomatic(selectionRef, {
								weights: defaults.scoring.weights,
								providerPriority: defaults.scoring.providerPriority
							});
							return freezeAutomaticSelections(automatic, selectionFrom);
						}
						return selectionFrom.storedSelections.map((selection) =>
							freezeApplyStoredSelection(selection, selectionFrom)
						);
					})();
					selectionCache.set(selectionCacheKey, pendingSelections);
				}
				selections = await pendingSelections;
			}

			const destinationSlots =
				itemSkip || selections.length === 0
					? []
					: await dependencies.resolveDestinationSlots({
							context,
							target,
							selectionFrom,
							selections,
							destinations
						});
			validateDestinationSnapshots(destinationSlots, destinations, selections);
			materialized.push({
				target: target.item.identity,
				selectionFrom: selectionFrom.item.identity,
				discovery,
				selections,
				destinationSlots,
				itemSkip
			});
		}

		const plannedAt = clock();
		if (!Number.isFinite(plannedAt.getTime())) {
			throw new ApplyPlannerError('invalid_request', 'Planner clock returned an invalid date');
		}
		const payload = buildApplyPlanPayload({
			plannedAt: plannedAt.toISOString(),
			context,
			defaults,
			items: materialized
		});
		if (payload.summary.operationCount === 0) return { payload, plan: null };

		const serverInstanceId =
			context.source === 'cross_server' || payload.scope.serverInstanceIds.length !== 1
				? null
				: payload.scope.serverInstanceIds[0];
		const librarySectionKey =
			serverInstanceId !== null && payload.scope.librarySectionKeys.length === 1
				? payload.scope.librarySectionKeys[0]
				: null;
		const plan = await dependencies.persistPlan({
			kind: APPLY_PLAN_KIND,
			payload,
			serverInstanceId,
			librarySectionKey,
			ttlMs: request.ttlMs
		});
		return { payload, plan };
	};
}

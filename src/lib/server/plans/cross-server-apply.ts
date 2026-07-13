import { canonicalJson } from './canonical-json';
import { confirmApplyPlan, type ConfirmApplyPlanDependencies } from './apply-api';
import {
	APPLY_PLAN_KIND,
	type ApplyItemIdentity,
	type ApplyPlanPayloadV1,
	type CrossServerMatchResolution,
	type ExactExternalMatch
} from './apply-plan';
import { assertApplyPlanPayload } from './apply-plan-validation';
import {
	ApplyPlannerError,
	type ApplyItemRef,
	type ApplyMethodInput,
	type PlanArtworkApplyRequest
} from './apply-planner';
import { OperationPlanError } from './operation-plan-store';

export type CrossServerInstanceState = 'enabled' | 'disabled' | 'missing';

export interface CrossServerCandidateLookup {
	serverState: CrossServerInstanceState;
	items: ApplyItemIdentity[];
}

/** All persistence reads are identifier-based; implementations must not query by title. */
export interface CrossServerMatchRepository {
	loadItem(ref: ApplyItemRef): Promise<ApplyItemIdentity | null>;
	findExactCandidates(input: {
		serverInstanceId: string;
		match: ExactExternalMatch;
		sourceType: ApplyItemIdentity['type'];
		sourceMediaType: ApplyItemIdentity['mediaType'];
	}): Promise<CrossServerCandidateLookup>;
}

export interface CrossServerApplyMatchRequest {
	sourceItem: ApplyItemRef;
	destinationServerInstanceIds: string[];
	match: ExactExternalMatch;
}

export interface CrossServerApplyPreviewRequest extends CrossServerApplyMatchRequest {
	selectionMode: 'auto' | 'stored';
	method?: ApplyMethodInput;
	ttlMs?: number;
}

export interface ResolvedCrossServerApply {
	sourceItem: ApplyItemIdentity;
	destinationServerInstanceIds: string[];
	resolutions: CrossServerMatchResolution[];
	targets: ApplyItemRef[];
}

export interface CrossServerApplyPlannerDependencies<Result> {
	matchRepository: CrossServerMatchRepository;
	planApply(request: PlanArtworkApplyRequest): Promise<Result>;
}

export interface ConfirmCrossServerApplyRequest extends CrossServerApplyMatchRequest {
	planId: string;
	digest: string;
}

export interface ConfirmCrossServerApplyDependencies extends ConfirmApplyPlanDependencies {
	matchRepository: CrossServerMatchRepository;
}

function externalIdentity(item: ApplyItemIdentity, match: ExactExternalMatch): string | null {
	if (match.namespace === 'tmdb') return item.tmdbId;
	if (match.namespace === 'imdb') return item.imdbId;
	return item.tvdbId;
}

/** Exact, type-safe identity comparison. Title and year are deliberately absent. */
export function hasExactCrossServerIdentity(
	source: ApplyItemIdentity,
	candidate: ApplyItemIdentity,
	match: ExactExternalMatch
): boolean {
	if (
		externalIdentity(source, match) !== match.value ||
		externalIdentity(candidate, match) !== match.value ||
		source.type !== candidate.type
	) {
		return false;
	}
	return (
		match.namespace !== 'tmdb' ||
		(source.mediaType !== null && source.mediaType === candidate.mediaType)
	);
}

function assertRef(ref: ApplyItemRef, label: string): void {
	if (
		!ref ||
		typeof ref.serverInstanceId !== 'string' ||
		!ref.serverInstanceId ||
		ref.serverInstanceId.trim() !== ref.serverInstanceId ||
		!Number.isSafeInteger(ref.mediaItemId) ||
		ref.mediaItemId <= 0
	) {
		throw new ApplyPlannerError('invalid_request', `${label} must be explicit`);
	}
}

function normalizeDestinationServerIds(input: CrossServerApplyMatchRequest): string[] {
	if (!Array.isArray(input.destinationServerInstanceIds)) {
		throw new ApplyPlannerError('invalid_request', 'Destination servers must be explicit');
	}
	const values = [...input.destinationServerInstanceIds];
	if (
		values.length === 0 ||
		new Set(values).size !== values.length ||
		values.some((value) => typeof value !== 'string' || !value || value.trim() !== value) ||
		values.includes(input.sourceItem.serverInstanceId)
	) {
		throw new ApplyPlannerError(
			'invalid_request',
			'Destination servers must be unique and different from the source'
		);
	}
	return values.sort();
}

function assertMatch(match: ExactExternalMatch): void {
	if (
		!match ||
		typeof match.namespace !== 'string' ||
		!['tmdb', 'imdb', 'tvdb'].includes(match.namespace) ||
		typeof match.value !== 'string' ||
		!match.value ||
		match.value.trim() !== match.value
	) {
		throw new ApplyPlannerError(
			'invalid_request',
			'Cross-server apply requires an exact external identity'
		);
	}
}

function validateSource(
	requested: ApplyItemRef,
	item: ApplyItemIdentity | null,
	match: ExactExternalMatch
): ApplyItemIdentity {
	if (!item) throw new ApplyPlannerError('item_not_found', 'Cross-server source was not found');
	if (
		item.serverInstanceId !== requested.serverInstanceId ||
		item.mediaItemId !== requested.mediaItemId
	) {
		throw new ApplyPlannerError('scope_mismatch', 'Cross-server source scope changed');
	}
	if (
		externalIdentity(item, match) !== match.value ||
		(match.namespace === 'tmdb' && item.mediaType === null)
	) {
		throw new ApplyPlannerError(
			'external_identity_mismatch',
			'Cross-server source does not have the explicit unambiguous identity'
		);
	}
	return item;
}

function resolutionForLookup(
	serverInstanceId: string,
	lookup: CrossServerCandidateLookup,
	source: ApplyItemIdentity,
	match: ExactExternalMatch
): CrossServerMatchResolution {
	if (
		!['enabled', 'disabled', 'missing'].includes(lookup.serverState) ||
		!Array.isArray(lookup.items)
	) {
		throw new ApplyPlannerError('scope_mismatch', 'Invalid cross-server match lookup');
	}
	if (lookup.serverState !== 'enabled') {
		if (lookup.items.length !== 0) {
			throw new ApplyPlannerError('scope_mismatch', 'Unavailable servers cannot return matches');
		}
		return {
			serverInstanceId,
			status: lookup.serverState === 'missing' ? 'server_not_found' : 'server_disabled',
			candidateItemIds: []
		};
	}

	const ids = lookup.items.map((item) => item.mediaItemId).sort((a, b) => a - b);
	if (
		new Set(ids).size !== ids.length ||
		lookup.items.some(
			(item) =>
				item.serverInstanceId !== serverInstanceId ||
				!Number.isSafeInteger(item.mediaItemId) ||
				item.mediaItemId <= 0 ||
				!hasExactCrossServerIdentity(source, item, match)
		)
	) {
		throw new ApplyPlannerError(
			'external_identity_mismatch',
			'Cross-server lookup returned a non-exact identity'
		);
	}
	return {
		serverInstanceId,
		status: ids.length === 0 ? 'not_found' : ids.length === 1 ? 'matched' : 'ambiguous',
		candidateItemIds: ids
	};
}

/** Resolve every explicitly named destination without choosing through title similarity. */
export async function resolveCrossServerApplyMatches(
	request: CrossServerApplyMatchRequest,
	repository: CrossServerMatchRepository
): Promise<ResolvedCrossServerApply> {
	assertRef(request.sourceItem, 'Cross-server source');
	assertMatch(request.match);
	const destinationServerInstanceIds = normalizeDestinationServerIds(request);
	const source = validateSource(
		request.sourceItem,
		await repository.loadItem(request.sourceItem),
		request.match
	);
	const lookups = await Promise.all(
		destinationServerInstanceIds.map(async (serverInstanceId) => ({
			serverInstanceId,
			lookup: await repository.findExactCandidates({
				serverInstanceId,
				match: request.match,
				sourceType: source.type,
				sourceMediaType: source.mediaType
			})
		}))
	);
	const resolutions = lookups.map(({ serverInstanceId, lookup }) =>
		resolutionForLookup(serverInstanceId, lookup, source, request.match)
	);
	const targets = resolutions.flatMap((resolution) =>
		resolution.status === 'matched'
			? [
					{
						serverInstanceId: resolution.serverInstanceId,
						mediaItemId: resolution.candidateItemIds[0]
					}
				]
			: []
	);
	return {
		sourceItem: source,
		destinationServerInstanceIds,
		resolutions,
		targets
	};
}

/** Build the shared frozen apply plan with exact match decisions embedded in its digest. */
export async function previewCrossServerApplyPlan<Result>(
	request: CrossServerApplyPreviewRequest,
	dependencies: CrossServerApplyPlannerDependencies<Result>
): Promise<Result> {
	if (request.selectionMode !== 'auto' && request.selectionMode !== 'stored') {
		throw new ApplyPlannerError('invalid_request', 'Invalid cross-server selection mode');
	}
	const resolved = await resolveCrossServerApplyMatches(request, dependencies.matchRepository);
	return dependencies.planApply({
		context: {
			source: 'cross_server',
			sourceItem: request.sourceItem,
			match: request.match,
			destinationServerInstanceIds: resolved.destinationServerInstanceIds,
			resolutions: resolved.resolutions
		},
		targets: resolved.targets.map((target) => ({
			...target,
			selectionFrom: request.sourceItem
		})),
		selectionMode: request.selectionMode,
		method: request.method,
		ttlMs: request.ttlMs
	});
}

function same(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

/**
 * Re-resolve skipped and matched servers before the shared single-use confirmation.
 * A newly appeared/disappeared match or resolved ambiguity requires a fresh preview;
 * execution never silently broadens to it.
 */
export async function confirmCrossServerApplyPlan(
	request: ConfirmCrossServerApplyRequest,
	dependencies: ConfirmCrossServerApplyDependencies
): Promise<{ jobId: number; planId: string; digest: string }> {
	assertRef(request.sourceItem, 'Cross-server source');
	assertMatch(request.match);
	const destinationServerInstanceIds = normalizeDestinationServerIds(request);
	const pending = await dependencies.store.validate<ApplyPlanPayloadV1>(request.planId, {
		kind: APPLY_PLAN_KIND,
		digest: request.digest,
		serverInstanceId: null
	});
	try {
		assertApplyPlanPayload(pending.payload);
	} catch {
		throw new OperationPlanError('plan_corrupt', request.planId);
	}
	const context = pending.payload.context;
	if (
		context.source !== 'cross_server' ||
		context.sourceItem.serverInstanceId !== request.sourceItem.serverInstanceId ||
		context.sourceItem.mediaItemId !== request.sourceItem.mediaItemId ||
		!same(context.match, request.match) ||
		!same(context.destinationServerInstanceIds, destinationServerInstanceIds)
	) {
		throw new OperationPlanError('plan_scope_mismatch', request.planId);
	}
	const fresh = await resolveCrossServerApplyMatches(request, dependencies.matchRepository);
	if (
		!same(fresh.sourceItem, context.sourceItem) ||
		!same(fresh.resolutions, context.resolutions)
	) {
		throw new OperationPlanError('plan_stale', request.planId);
	}
	return confirmApplyPlan({ planId: request.planId, digest: request.digest }, dependencies);
}

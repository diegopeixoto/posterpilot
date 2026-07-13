import { buildApplyPlanPayload } from '$lib/server/plans/apply-plan';
import { canonicalJsonDigest, hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { JobPayload } from './types';

export interface RetryOutcomeProjection {
	id: number;
	mediaItemId: number | null;
	destination: string | null;
	kind: string | null;
	season: number | null;
	episode: number | null;
	status: 'success' | 'failed' | 'skipped' | 'interrupted';
	retryable: boolean;
	result: Record<string, unknown> | null;
}

export interface BuiltRetryPayload {
	payload: JobPayload;
	outcomeIds: number[];
}

export class JobRetryError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = 'JobRetryError';
	}
}

function outcomeUnitKey(outcome: RetryOutcomeProjection): string {
	const operationId = outcome.result?.operationId;
	if (typeof operationId === 'string') return `operation:${operationId}`;
	return [
		'item',
		outcome.mediaItemId ?? 'none',
		outcome.destination ?? 'none',
		outcome.kind ?? 'none',
		outcome.season ?? 'root',
		outcome.episode ?? 'root'
	].join(':');
}

/** Only the latest outcome for a unit can be retried; a later success wins. */
export function latestRetryableFailures(
	outcomes: RetryOutcomeProjection[]
): RetryOutcomeProjection[] {
	const latest = new Map<string, RetryOutcomeProjection>();
	for (const outcome of [...outcomes].sort((a, b) => a.id - b.id)) {
		latest.set(outcomeUnitKey(outcome), outcome);
	}
	return [...latest.values()]
		.filter((outcome) => outcome.status === 'failed' && outcome.retryable)
		.sort((a, b) => a.id - b.id);
}

function requireItemIds(outcomes: RetryOutcomeProjection[]): number[] {
	const ids = [...new Set(outcomes.map((outcome) => outcome.mediaItemId))];
	if (ids.some((id) => id === null || !Number.isSafeInteger(id) || id! <= 0)) {
		throw new JobRetryError('job_retry_outcome_invalid');
	}
	return (ids as number[]).sort((a, b) => a - b);
}

function retryPlanId(parentJobId: number, destination: string, outcomeIds: number[]): string {
	return `job-retry-${hashCanonicalJson({ parentJobId, destination, outcomeIds }).slice(0, 48)}`;
}

function buildApplyRetryPayloads(
	parentJobId: number,
	payload: Extract<JobPayload, { kind: 'apply' }>,
	outcomes: RetryOutcomeProjection[],
	plannedAt: string
): BuiltRetryPayload[] {
	const operationOutcome = new Map<string, RetryOutcomeProjection>();
	for (const outcome of outcomes) {
		const operationId = outcome.result?.operationId;
		if (typeof operationId !== 'string') throw new JobRetryError('job_retry_outcome_invalid');
		operationOutcome.set(operationId, outcome);
	}
	const selectedIds = new Set(operationOutcome.keys());
	const knownOperationIds = new Set(
		payload.plan.items.flatMap((item) => item.operations.map((operation) => operation.id))
	);
	if ([...selectedIds].some((id) => !knownOperationIds.has(id))) {
		throw new JobRetryError('job_retry_outcome_invalid');
	}

	const destinations = [
		...new Set(
			payload.plan.items.flatMap((item) =>
				item.operations
					.filter((operation) => selectedIds.has(operation.id))
					.map((operation) => operation.destination)
			)
		)
	].sort();

	return destinations.map((destination) => {
		const inputs = payload.plan.items.flatMap((item) => {
			const operations = item.operations.filter(
				(operation) => operation.destination === destination && selectedIds.has(operation.id)
			);
			if (!operations.length) return [];
			const selectionFingerprints = new Set(
				operations.map((operation) => operation.selection.fingerprint)
			);
			const slotKeys = new Set(
				operations.map(
					(operation) =>
						`${operation.slot.kind}:${operation.slot.season ?? 'root'}:${operation.slot.episode ?? 'root'}:${operation.targetId}`
				)
			);
			return [
				{
					target: item.target,
					selectionFrom: item.selectionFrom,
					discovery: item.discovery,
					selections: item.selections.filter((selection) =>
						selectionFingerprints.has(selection.fingerprint)
					),
					destinationSlots: item.destinationSlots.filter(
						(snapshot) =>
							snapshot.destination === destination &&
							!!snapshot.targetId &&
							slotKeys.has(
								`${snapshot.slot.kind}:${snapshot.slot.season ?? 'root'}:${snapshot.slot.episode ?? 'root'}:${snapshot.targetId}`
							)
					),
					itemSkip: null
				}
			];
		});
		const plan = buildApplyPlanPayload({
			plannedAt,
			context: payload.plan.context,
			defaults: {
				...payload.plan.defaults,
				effectiveMethod: destination as 'server' | 'kometa',
				methodSource: 'explicit'
			},
			items: inputs
		});
		if (plan.summary.operationCount === 0) {
			throw new JobRetryError('job_retry_outcome_invalid');
		}
		const digest = canonicalJsonDigest(plan).digest;
		const outcomeIds = outcomes
			.filter((outcome) => {
				const operationId = outcome.result?.operationId;
				return (
					typeof operationId === 'string' &&
					plan.items.some((item) =>
						item.operations.some((operation) => operation.id === operationId)
					)
				);
			})
			.map((outcome) => outcome.id)
			.sort((a, b) => a - b);
		return {
			payload: {
				kind: 'apply',
				planId: retryPlanId(parentJobId, destination, outcomeIds),
				digest,
				plan
			},
			outcomeIds
		};
	});
}

/** Build immutable failed-only execution payloads without touching the database. */
export function buildRetryPayloads(
	parentJobId: number,
	parentPayload: JobPayload,
	outcomes: RetryOutcomeProjection[],
	plannedAt: string
): BuiltRetryPayload[] {
	if (!outcomes.length) throw new JobRetryError('job_retry_no_eligible_outcomes');
	if (parentPayload.kind === 'sync') {
		return [
			{
				payload: { ...parentPayload, itemIds: requireItemIds(outcomes) },
				outcomeIds: outcomes.map((outcome) => outcome.id).sort((a, b) => a - b)
			}
		];
	}
	if (parentPayload.kind === 'discover') {
		return [
			{
				payload: { ...parentPayload, itemIds: requireItemIds(outcomes) },
				outcomeIds: outcomes.map((outcome) => outcome.id).sort((a, b) => a - b)
			}
		];
	}
	if (parentPayload.kind === 'automation') {
		return [
			{
				payload: { ...parentPayload, retryItemIds: requireItemIds(outcomes) },
				outcomeIds: outcomes.map((outcome) => outcome.id).sort((a, b) => a - b)
			}
		];
	}
	if (parentPayload.kind === 'undo') {
		// An undo restores the snapshot captured before one specific revision. Replaying
		// a failed operation from the old plan could overwrite whatever the timeline
		// holds now, so recovery goes through a fresh preview of the current history.
		throw new JobRetryError('job_retry_unsupported_kind');
	}
	return buildApplyRetryPayloads(parentJobId, parentPayload, outcomes, plannedAt);
}

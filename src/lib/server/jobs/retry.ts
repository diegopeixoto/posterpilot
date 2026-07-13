import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { jobItemOutcomes, jobs, operationPlans } from '$lib/server/db/schema';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import { encodeOperationPlanPayload } from '$lib/server/plans/operation-plan-payload';
import { enqueueJobDetailed, type EnqueueJobResult } from './runner';
import { jobServerScopeCondition } from './scope';
import type { JobPayload } from './types';
import {
	buildRetryPayloads,
	JobRetryError,
	latestRetryableFailures,
	type RetryOutcomeProjection
} from './retry-plan';

export { JobRetryError, type RetryOutcomeProjection } from './retry-plan';

const RETRYABLE_PARENT_STATUSES = ['partial_failed', 'failed', 'interrupted'] as const;

export interface RetryFailedJobResult {
	jobIds: number[];
	reused: boolean;
	outcomeIds: number[];
}

/** Create/reuse child jobs containing exactly the selected latest retryable failures. */
export async function retryFailedJob(input: {
	parentJobId: number;
	serverInstanceId: string;
	outcomeIds?: number[];
}): Promise<RetryFailedJobResult> {
	if (!Number.isSafeInteger(input.parentJobId) || input.parentJobId <= 0) {
		throw new JobRetryError('job_retry_selection_invalid');
	}
	const [parent] = await db
		.select()
		.from(jobs)
		.where(and(eq(jobs.id, input.parentJobId), jobServerScopeCondition(input.serverInstanceId)))
		.limit(1);
	if (!parent) throw new JobRetryError('job_not_found');
	if (
		!RETRYABLE_PARENT_STATUSES.includes(parent.status as (typeof RETRYABLE_PARENT_STATUSES)[number])
	) {
		throw new JobRetryError('job_retry_not_terminal');
	}
	const rows = await db
		.select({
			id: jobItemOutcomes.id,
			mediaItemId: jobItemOutcomes.mediaItemId,
			destination: jobItemOutcomes.destination,
			kind: jobItemOutcomes.kind,
			season: jobItemOutcomes.season,
			episode: jobItemOutcomes.episode,
			status: jobItemOutcomes.status,
			retryable: jobItemOutcomes.retryable,
			result: jobItemOutcomes.result
		})
		.from(jobItemOutcomes)
		.where(eq(jobItemOutcomes.jobId, parent.id))
		.orderBy(asc(jobItemOutcomes.id));
	const eligible = latestRetryableFailures(rows);
	const selectedIds = input.outcomeIds
		? [...new Set(input.outcomeIds)].sort((a, b) => a - b)
		: eligible.map((outcome) => outcome.id);
	if (
		selectedIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
		(input.outcomeIds && selectedIds.length !== input.outcomeIds.length)
	) {
		throw new JobRetryError('job_retry_selection_invalid');
	}
	const eligibleById = new Map(eligible.map((outcome) => [outcome.id, outcome]));
	const selected = selectedIds.map((id) => eligibleById.get(id));
	if (!selectedIds.length || selected.some((outcome) => !outcome)) {
		throw new JobRetryError('job_retry_no_eligible_outcomes');
	}
	const plannedAt = (parent.finishedAt ?? parent.updatedAt ?? parent.createdAt).toISOString();
	const built = buildRetryPayloads(
		parent.id,
		parent.payload as unknown as JobPayload,
		selected as RetryOutcomeProjection[],
		plannedAt
	);
	const results: EnqueueJobResult[] = [];
	for (const retry of built) {
		if (retry.payload.kind === 'apply') {
			const canonical = canonicalJsonDigest(retry.payload.plan);
			const firstServer = retry.payload.plan.scope.serverInstanceIds[0] ?? null;
			const firstLibrary = retry.payload.plan.scope.librarySectionKeys[0] ?? null;
			const createdAt = new Date(plannedAt);
			await db
				.insert(operationPlans)
				.values({
					id: retry.payload.planId,
					kind: 'artwork_apply_retry',
					serverInstanceId:
						retry.payload.plan.scope.serverInstanceIds.length === 1 ? firstServer : null,
					librarySectionKey:
						retry.payload.plan.scope.librarySectionKeys.length === 1 ? firstLibrary : null,
					payload: encodeOperationPlanPayload(canonical.canonicalJson),
					digest: canonical.digest,
					createdAt,
					expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
					consumedAt: createdAt
				})
				.onConflictDoNothing();
		}
		const salt = `parent:${parent.id}:outcomes:${retry.outcomeIds.join(',')}`;
		results.push(
			await enqueueJobDetailed(retry.payload, {
				parentJobId: parent.id,
				initiator: 'retry',
				trigger: 'failed_subset',
				persistedType: 'retry',
				idempotencySalt: salt,
				maxAttempts: parent.maxAttempts
			})
		);
	}
	return {
		jobIds: results.map((result) => result.jobId),
		reused: results.every((result) => result.reused),
		outcomeIds: selectedIds
	};
}

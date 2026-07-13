import { and, eq, sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	childSelections,
	jobItemOutcomes,
	jobs,
	mediaItems,
	reviewEvents
} from '$lib/server/db/schema';
import { reviewStateExpression } from './state-sql';

type Database = LibSQLDatabase<typeof schema>;

export type ApplyAndNextErrorCode =
	| 'invalid_request'
	| 'item_not_found'
	| 'job_not_found'
	| 'job_not_completed'
	| 'job_not_verified'
	| 'selection_changed'
	| 'review_not_completed';

export class ApplyAndNextError extends Error {
	constructor(readonly code: ApplyAndNextErrorCode) {
		super(code);
		this.name = 'ApplyAndNextError';
	}
}

interface ApplyOperationProjection {
	id: string;
	target: { serverInstanceId: string; mediaItemId: number };
	destination: 'server' | 'kometa';
	slot: { kind: string; season: number | null; episode: number | null };
	selection: { url: string };
}

interface ApplyJobProjection {
	id: number;
	serverInstanceId: string | null;
	type: string;
	status: string;
	payload: Record<string, unknown>;
	result: Record<string, unknown> | null;
}

interface ApplyOutcomeProjection {
	serverInstanceId: string;
	mediaItemId: number | null;
	status: string;
	result: Record<string, unknown> | null;
}

function count(value: unknown): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function readOperations(payload: Record<string, unknown>): ApplyOperationProjection[] {
	if (payload.kind !== 'apply' || !payload.plan || typeof payload.plan !== 'object') {
		throw new ApplyAndNextError('job_not_verified');
	}
	const items = (payload.plan as Record<string, unknown>).items;
	if (!Array.isArray(items) || items.length !== 1) {
		throw new ApplyAndNextError('job_not_verified');
	}
	const operations = (items[0] as Record<string, unknown>)?.operations;
	if (!Array.isArray(operations) || operations.length === 0) {
		throw new ApplyAndNextError('job_not_verified');
	}
	return operations as ApplyOperationProjection[];
}

function operationId(outcome: ApplyOutcomeProjection): string | null {
	return typeof outcome.result?.operationId === 'string' ? outcome.result.operationId : null;
}

/**
 * Prove that this exact single-item apply job finished every frozen operation with
 * provider-aware verification. Completed jobs containing skips are intentionally
 * ineligible: Apply and next advances only when every selected target succeeded.
 */
export function validateApplyAndNextCompletion(input: {
	serverInstanceId: string;
	mediaItemId: number;
	job: ApplyJobProjection;
	outcomes: ApplyOutcomeProjection[];
}): ApplyOperationProjection[] {
	const { serverInstanceId, mediaItemId, job, outcomes } = input;
	if (job.serverInstanceId !== serverInstanceId || job.type !== 'apply') {
		throw new ApplyAndNextError('job_not_found');
	}
	if (job.status !== 'completed') throw new ApplyAndNextError('job_not_completed');
	const operations = readOperations(job.payload);
	if (
		operations.some(
			(operation) =>
				operation.target?.serverInstanceId !== serverInstanceId ||
				operation.target?.mediaItemId !== mediaItemId ||
				!operation.id ||
				!operation.selection?.url
		)
	) {
		throw new ApplyAndNextError('job_not_verified');
	}
	const summary =
		job.result?.summary && typeof job.result.summary === 'object'
			? (job.result.summary as Record<string, unknown>)
			: null;
	if (
		!summary ||
		count(summary.operationCount) !== operations.length ||
		count(summary.succeeded) !== operations.length ||
		count(summary.failed) !== 0 ||
		count(summary.skipped) !== 0 ||
		outcomes.length !== operations.length
	) {
		throw new ApplyAndNextError('job_not_verified');
	}

	const expected = new Set(operations.map((operation) => operation.id));
	const observed = new Set<string>();
	for (const outcome of outcomes) {
		const id = operationId(outcome);
		const verification = outcome.result?.verification;
		if (
			outcome.serverInstanceId !== serverInstanceId ||
			outcome.mediaItemId !== mediaItemId ||
			outcome.status !== 'success' ||
			!id ||
			!expected.has(id) ||
			observed.has(id) ||
			(verification !== 'exact' && verification !== 'best_effort')
		) {
			throw new ApplyAndNextError('job_not_verified');
		}
		observed.add(id);
	}
	if (observed.size !== expected.size) throw new ApplyAndNextError('job_not_verified');
	return operations;
}

function slotKey(slot: ApplyOperationProjection['slot']): string {
	return `${slot.kind}:${slot.season ?? 'root'}:${slot.episode ?? 'root'}`;
}

function frozenSelections(operations: ApplyOperationProjection[]): Map<string, string> {
	const selections = new Map<string, string>();
	for (const operation of operations) {
		const key = slotKey(operation.slot);
		const prior = selections.get(key);
		if (prior && prior !== operation.selection.url) {
			throw new ApplyAndNextError('job_not_verified');
		}
		selections.set(key, operation.selection.url);
	}
	return selections;
}

/** Atomically complete review intent only while the exact applied staging is unchanged. */
export function createApplyAndNextCompletionService(
	database: Database,
	clock: () => Date = () => new Date()
) {
	return async function complete(input: {
		serverInstanceId: string;
		mediaItemId: number;
		jobId: number;
	}) {
		if (
			!input.serverInstanceId.trim() ||
			!Number.isSafeInteger(input.mediaItemId) ||
			input.mediaItemId <= 0 ||
			!Number.isSafeInteger(input.jobId) ||
			input.jobId <= 0
		) {
			throw new ApplyAndNextError('invalid_request');
		}

		return database.transaction(async (tx) => {
			const scope = and(
				eq(mediaItems.serverInstanceId, input.serverInstanceId),
				eq(mediaItems.id, input.mediaItemId)
			);
			const [item] = await tx
				.select({
					selectedPosterUrl: mediaItems.selectedPosterUrl,
					selectedBackgroundUrl: mediaItems.selectedBackgroundUrl,
					state: reviewStateExpression
				})
				.from(mediaItems)
				.where(scope)
				.limit(1);
			if (!item) throw new ApplyAndNextError('item_not_found');

			// A lost response can be retried without reapplying or duplicating history.
			const [priorCompletion] = await tx
				.select({ id: reviewEvents.id, state: reviewEvents.toState })
				.from(reviewEvents)
				.where(
					and(
						eq(reviewEvents.serverInstanceId, input.serverInstanceId),
						eq(reviewEvents.mediaItemId, input.mediaItemId),
						eq(reviewEvents.action, 'completed'),
						sql`json_extract(${reviewEvents.context}, '$.jobId') = ${input.jobId}`
					)
				)
				.limit(1);
			if (priorCompletion) {
				// Idempotency applies only while the item still reflects that completion.
				// A newly staged selection must never be hidden by replaying an old request.
				if (item.state !== 'completed') {
					throw new ApplyAndNextError('selection_changed');
				}
				return { state: priorCompletion.state ?? 'completed', eventId: priorCompletion.id };
			}

			const [job] = await tx
				.select({
					id: jobs.id,
					serverInstanceId: jobs.serverInstanceId,
					type: jobs.type,
					status: jobs.status,
					payload: jobs.payload,
					result: jobs.result
				})
				.from(jobs)
				.where(and(eq(jobs.id, input.jobId), eq(jobs.serverInstanceId, input.serverInstanceId)))
				.limit(1);
			if (!job) throw new ApplyAndNextError('job_not_found');
			const outcomes = await tx
				.select({
					serverInstanceId: jobItemOutcomes.serverInstanceId,
					mediaItemId: jobItemOutcomes.mediaItemId,
					status: jobItemOutcomes.status,
					result: jobItemOutcomes.result
				})
				.from(jobItemOutcomes)
				.where(eq(jobItemOutcomes.jobId, input.jobId));
			const operations = validateApplyAndNextCompletion({
				serverInstanceId: input.serverInstanceId,
				mediaItemId: input.mediaItemId,
				job: job as ApplyJobProjection,
				outcomes
			});
			const expected = frozenSelections(operations);
			const children = await tx
				.select({
					id: childSelections.id,
					kind: childSelections.kind,
					season: childSelections.season,
					episode: childSelections.episode,
					url: childSelections.url
				})
				.from(childSelections)
				.where(
					and(
						eq(childSelections.serverInstanceId, input.serverInstanceId),
						eq(childSelections.mediaItemId, input.mediaItemId)
					)
				);

			const expectedPoster = expected.get('poster:root:root') ?? null;
			const expectedBackground = expected.get('background:root:root') ?? null;
			const expectedChildren = new Map(
				[...expected].filter(([key]) => !key.endsWith(':root:root'))
			);
			if (
				item.selectedPosterUrl !== expectedPoster ||
				item.selectedBackgroundUrl !== expectedBackground ||
				children.length !== expectedChildren.size ||
				children.some((child) => expectedChildren.get(slotKey(child)) !== child.url)
			) {
				throw new ApplyAndNextError('selection_changed');
			}

			const completedAt = clock();
			await tx
				.update(mediaItems)
				.set({ selectedPosterUrl: null, selectedBackgroundUrl: null, reviewedAt: completedAt })
				.where(scope);
			await tx
				.delete(childSelections)
				.where(
					and(
						eq(childSelections.serverInstanceId, input.serverInstanceId),
						eq(childSelections.mediaItemId, input.mediaItemId)
					)
				);
			const [completed] = await tx
				.select({ state: reviewStateExpression })
				.from(mediaItems)
				.where(scope)
				.limit(1);
			if (completed?.state !== 'completed') {
				throw new ApplyAndNextError('review_not_completed');
			}
			const [event] = await tx
				.insert(reviewEvents)
				.values({
					serverInstanceId: input.serverInstanceId,
					mediaItemId: input.mediaItemId,
					action: 'completed',
					fromState: item.state,
					toState: completed.state,
					context: { source: 'apply_and_next', jobId: input.jobId },
					createdAt: completedAt
				})
				.returning({ id: reviewEvents.id });
			return { state: completed.state, eventId: event.id };
		});
	};
}

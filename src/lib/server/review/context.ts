import { randomUUID } from 'node:crypto';
import type { ReviewFilter } from './query';
import { listReviewItemIds } from './query';
import { resolveStableReviewNeighbors } from './context-core';

export { reviewItemPath, reviewReturnPath } from './context-core';

const CONTEXT_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_CONTEXTS = 256;

interface ReviewContextSnapshot {
	id: string;
	filter: ReviewFilter;
	orderedIds: number[];
	expiresAt: number;
}

export interface ReviewContextNavigation {
	contextId: string;
	serverInstanceId: string;
	previousItemId: number | null;
	nextItemId: number | null;
	matchingCount: number;
}

const contexts = new Map<string, ReviewContextSnapshot>();

function copyFilter(filter: ReviewFilter): ReviewFilter {
	return {
		...filter,
		...(filter.changedSince ? { changedSince: new Date(filter.changedSince) } : {})
	};
}

function prune(now: number): void {
	for (const [id, context] of contexts) {
		if (context.expiresAt <= now) contexts.delete(id);
	}
	while (contexts.size >= MAX_CONTEXTS) {
		const oldest = contexts.keys().next().value as string | undefined;
		if (!oldest) break;
		contexts.delete(oldest);
	}
}

/** Keep a bounded server-side snapshot; clients receive only its opaque id. */
export function createReviewContext(
	filter: ReviewFilter,
	orderedIds: number[],
	options: { now?: number; id?: string } = {}
): string | null {
	const ids = [...new Set(orderedIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
	if (!filter.serverInstanceId.trim() || ids.length === 0) return null;
	const now = options.now ?? Date.now();
	prune(now);
	const id = options.id ?? randomUUID();
	contexts.set(id, {
		id,
		filter: copyFilter(filter),
		orderedIds: ids,
		expiresAt: now + CONTEXT_TTL_MS
	});
	return id;
}

export async function resolveReviewContextNavigation(
	contextId: string | null | undefined,
	currentItemId: number,
	now = Date.now()
): Promise<ReviewContextNavigation | null> {
	if (!contextId || !Number.isSafeInteger(currentItemId) || currentItemId <= 0) return null;
	prune(now);
	const context = contexts.get(contextId);
	if (!context || context.expiresAt <= now) return null;
	const matchingIds = await listReviewItemIds(context.filter);
	const neighbors = resolveStableReviewNeighbors(context.orderedIds, matchingIds, currentItemId);
	if (!neighbors) return null;
	return {
		contextId: context.id,
		serverInstanceId: context.filter.serverInstanceId,
		...neighbors,
		matchingCount: matchingIds.length
	};
}

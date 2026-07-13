import { and, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { mediaItems, reviewEvents } from '$lib/server/db/schema';
import { reviewStateExpression } from './state-sql';
import type { ReviewState } from './state';

const REVIEW_ACTIONS = [
	'reviewed',
	'ignored',
	'unignored',
	'accepted_current',
	'staged',
	'completed'
] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export class ReviewActionError extends Error {
	constructor(public readonly code: 'invalid_request' | 'item_not_found') {
		super(code);
		this.name = 'ReviewActionError';
	}
}

export function parseReviewAction(value: unknown): ReviewAction {
	if (typeof value !== 'string' || !REVIEW_ACTIONS.includes(value as ReviewAction)) {
		throw new ReviewActionError('invalid_request');
	}
	return value as ReviewAction;
}

type Database = LibSQLDatabase<typeof schema>;

async function scopedState(
	database: Pick<Database, 'select'>,
	serverInstanceId: string,
	mediaItemId: number
): Promise<ReviewState | null> {
	const [row] = await database
		.select({ state: reviewStateExpression })
		.from(mediaItems)
		.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, mediaItemId)))
		.limit(1);
	return row?.state ?? null;
}

/** Persist review intent append-only while actionable state remains derived from facts. */
export function createReviewActionService(
	database: Database,
	clock: () => Date = () => new Date()
) {
	return async function perform(
		serverInstanceId: string,
		mediaItemId: number,
		action: ReviewAction,
		context: Record<string, unknown> | null = null
	) {
		if (!serverInstanceId.trim() || !Number.isSafeInteger(mediaItemId) || mediaItemId <= 0) {
			throw new ReviewActionError('invalid_request');
		}
		return database.transaction(async (tx) => {
			const fromState = await scopedState(tx, serverInstanceId, mediaItemId);
			if (!fromState) throw new ReviewActionError('item_not_found');
			const now = clock();
			const scope = and(
				eq(mediaItems.serverInstanceId, serverInstanceId),
				eq(mediaItems.id, mediaItemId)
			);
			switch (action) {
				case 'ignored':
					await tx.update(mediaItems).set({ ignored: true, reviewedAt: now }).where(scope);
					break;
				case 'unignored':
					await tx.update(mediaItems).set({ ignored: false, reviewedAt: null }).where(scope);
					break;
				case 'accepted_current':
					await tx
						.update(mediaItems)
						.set({ externalArtworkChangedAt: null, lastVerifiedAt: now, reviewedAt: now })
						.where(scope);
					break;
				case 'reviewed':
				case 'completed':
					await tx.update(mediaItems).set({ reviewedAt: now }).where(scope);
					break;
				case 'staged':
					break;
			}
			const toState = (await scopedState(tx, serverInstanceId, mediaItemId)) ?? fromState;
			const [event] = await tx
				.insert(reviewEvents)
				.values({
					serverInstanceId,
					mediaItemId,
					action,
					fromState,
					toState,
					context,
					createdAt: now
				})
				.returning();
			return { state: toState, event };
		});
	};
}

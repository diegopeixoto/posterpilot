import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { reviewViews } from '$lib/server/db/schema';
import { REVIEW_STATES, type ReviewState } from './state';
import type { ReviewAvailability, ReviewSort } from './query';

type Database = LibSQLDatabase<typeof schema>;

export class ReviewViewError extends Error {
	constructor(
		public readonly code:
			| 'invalid_request'
			| 'invalid_name'
			| 'duplicate_name'
			| 'view_not_found'
			| 'wrong_scope'
	) {
		super(code);
		this.name = 'ReviewViewError';
	}
}

export interface SavedReviewFilters {
	state?: ReviewState;
	type?: 'movie' | 'show';
	availability?: ReviewAvailability;
	q?: string;
	changedSince?: string;
}

export interface SavedReviewSort {
	by: ReviewSort;
}

function normalizeName(value: unknown): { name: string; normalizedName: string } {
	if (typeof value !== 'string') throw new ReviewViewError('invalid_name');
	const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	if (!name || name.length > 60 || /[\p{Cc}\p{Cf}]/u.test(name)) {
		throw new ReviewViewError('invalid_name');
	}
	return { name, normalizedName: name.toLocaleLowerCase('en-US') };
}

function optionalString(value: unknown, max: number): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') throw new ReviewViewError('invalid_request');
	const normalized = value.normalize('NFKC').trim();
	if (!normalized || normalized.length > max || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
		throw new ReviewViewError('invalid_request');
	}
	return normalized;
}

export function normalizeReviewViewDefinition(input: {
	name: unknown;
	librarySectionKey?: unknown;
	filters?: unknown;
	sort?: unknown;
}) {
	const name = normalizeName(input.name);
	if (typeof input.filters !== 'object' || input.filters === null || Array.isArray(input.filters)) {
		throw new ReviewViewError('invalid_request');
	}
	const raw = input.filters as Record<string, unknown>;
	const state = optionalString(raw.state, 40);
	const type = optionalString(raw.type, 10);
	const availability = optionalString(raw.availability, 20);
	const changedSince = optionalString(raw.changedSince, 40);
	if (state && !REVIEW_STATES.includes(state as ReviewState)) {
		throw new ReviewViewError('invalid_request');
	}
	if (type && type !== 'movie' && type !== 'show') throw new ReviewViewError('invalid_request');
	if (availability && !['candidates', 'mediux', 'none'].includes(availability)) {
		throw new ReviewViewError('invalid_request');
	}
	if (changedSince && Number.isNaN(Date.parse(changedSince))) {
		throw new ReviewViewError('invalid_request');
	}
	const sortInput =
		typeof input.sort === 'object' && input.sort !== null && !Array.isArray(input.sort)
			? (input.sort as Record<string, unknown>).by
			: undefined;
	const sort = optionalString(sortInput, 20) ?? 'priority';
	if (!['priority', 'updated', 'title', 'year'].includes(sort)) {
		throw new ReviewViewError('invalid_request');
	}
	return {
		...name,
		librarySectionKey: optionalString(input.librarySectionKey, 200) ?? null,
		filters: {
			...(state ? { state: state as ReviewState } : {}),
			...(type ? { type: type as 'movie' | 'show' } : {}),
			...(availability ? { availability: availability as ReviewAvailability } : {}),
			...(optionalString(raw.q, 200) ? { q: optionalString(raw.q, 200) } : {}),
			...(changedSince ? { changedSince } : {})
		} satisfies SavedReviewFilters,
		sort: { by: sort as ReviewSort } satisfies SavedReviewSort
	};
}

function duplicateError(error: unknown): boolean {
	return error instanceof Error && /unique|review_views_server_name_unique/i.test(error.message);
}

export function createReviewViewStore(
	database: Database,
	options: { generateId?: () => string; clock?: () => Date } = {}
) {
	const generateId = options.generateId ?? randomUUID;
	const clock = options.clock ?? (() => new Date());

	async function list(serverInstanceId: string) {
		if (!serverInstanceId.trim()) throw new ReviewViewError('invalid_request');
		return database
			.select()
			.from(reviewViews)
			.where(eq(reviewViews.serverInstanceId, serverInstanceId))
			.orderBy(asc(reviewViews.name));
	}

	async function get(serverInstanceId: string, id: string) {
		const [view] = await database
			.select()
			.from(reviewViews)
			.where(and(eq(reviewViews.serverInstanceId, serverInstanceId), eq(reviewViews.id, id)))
			.limit(1);
		if (!view) throw new ReviewViewError('view_not_found');
		return view;
	}

	async function create(
		serverInstanceId: string,
		input: Parameters<typeof normalizeReviewViewDefinition>[0]
	) {
		if (!serverInstanceId.trim()) throw new ReviewViewError('invalid_request');
		const normalized = normalizeReviewViewDefinition(input);
		const now = clock();
		try {
			const [view] = await database
				.insert(reviewViews)
				.values({
					id: generateId(),
					serverInstanceId,
					...normalized,
					createdAt: now,
					updatedAt: now
				})
				.returning();
			return view;
		} catch (error) {
			if (duplicateError(error)) throw new ReviewViewError('duplicate_name');
			throw error;
		}
	}

	async function update(
		serverInstanceId: string,
		id: string,
		input: Parameters<typeof normalizeReviewViewDefinition>[0]
	) {
		await get(serverInstanceId, id);
		const normalized = normalizeReviewViewDefinition(input);
		try {
			const [view] = await database
				.update(reviewViews)
				.set({ ...normalized, updatedAt: clock() })
				.where(and(eq(reviewViews.serverInstanceId, serverInstanceId), eq(reviewViews.id, id)))
				.returning();
			return view;
		} catch (error) {
			if (duplicateError(error)) throw new ReviewViewError('duplicate_name');
			throw error;
		}
	}

	async function remove(serverInstanceId: string, id: string) {
		await get(serverInstanceId, id);
		const [view] = await database
			.delete(reviewViews)
			.where(and(eq(reviewViews.serverInstanceId, serverInstanceId), eq(reviewViews.id, id)))
			.returning();
		return view;
	}

	return { list, get, create, update, remove };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal stand-in for the drizzle client: fetchText only ever reads one row and
// upserts one row, so the fake keeps a single slot keyed by nothing (the read path
// ignores the where-clause, which is enough for these single-URL tests).
const state = vi.hoisted(() => ({
	row: null as { url: string; body: string; fetchedAt: Date } | null
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (state.row ? [state.row] : [])
				})
			})
		}),
		insert: () => ({
			values: (v: { url: string; body: string; fetchedAt: Date }) => ({
				onConflictDoUpdate: async (cfg: { set: { body: string; fetchedAt: Date } }) => {
					state.row = { url: v.url, body: cfg.set.body, fetchedAt: cfg.set.fetchedAt };
				}
			})
		})
	}
}));

import { fetchText } from './index';

const REJECTED = '<form id="challenge-form" action="/cdn-cgi/challenge-platform/x"></form>';

function stubFetch(body: string): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(body, { status: 200 }))
	);
}

beforeEach(() => {
	state.row = null;
	vi.unstubAllGlobals();
});

describe('fetchText cache predicate', () => {
	it('never writes a body the predicate rejects', async () => {
		stubFetch(REJECTED);
		const body = await fetchText('https://example.com/page', {
			cacheTtlDays: 7,
			isCacheableBody: (text) => text !== REJECTED
		});
		expect(body).toBe(REJECTED);
		expect(state.row).toBeNull();
	});

	it('ignores a cached body the predicate rejects and fetches fresh', async () => {
		state.row = { url: 'cached', body: REJECTED, fetchedAt: new Date() };
		stubFetch('REAL BODY');
		const body = await fetchText('https://example.com/page', {
			cacheTtlDays: 7,
			isCacheableBody: (text) => text !== REJECTED
		});
		expect(body).toBe('REAL BODY');
		expect(state.row?.body).toBe('REAL BODY');
	});

	it('still serves a fresh, cacheable body without a network call', async () => {
		state.row = { url: 'cached', body: 'CACHED BODY', fetchedAt: new Date() };
		const fetchSpy = vi.fn(async () => new Response('REAL BODY', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const body = await fetchText('https://example.com/page', {
			cacheTtlDays: 7,
			isCacheableBody: (text) => text !== REJECTED
		});
		expect(body).toBe('CACHED BODY');
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

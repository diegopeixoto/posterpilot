import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	search: vi.fn(),
	confirm: vi.fn(),
	clear: vi.fn(),
	audit: vi.fn()
}));

vi.mock('$lib/server/tmdb/manual-match-runtime', () => ({
	searchManualTmdb: h.search,
	confirmManualTmdbMatch: h.confirm,
	clearManualTmdbMatch: h.clear,
	listTmdbResolutionAudit: h.audit
}));

import { ManualMatchError } from '$lib/server/tmdb/manual-match';
import { GET as SEARCH } from './search/+server';
import { DELETE as CLEAR, POST as PIN } from './pin/+server';
import { GET as AUDIT } from './audit/+server';

const ITEM = {
	id: 7,
	serverInstanceId: 'server-a',
	tmdbId: '550',
	mediaType: 'movie',
	resolved: true,
	resolutionReason: 'manual',
	manualMatchPinned: true,
	resolutionUpdatedAt: '2026-07-10T18:00:00.000Z'
};

function event(options: { body?: unknown; query?: string; serverId?: string; id?: string } = {}) {
	return {
		params: { serverId: options.serverId ?? 'server-a', id: options.id ?? '7' },
		url: new URL(`http://localhost/path${options.query ?? ''}`),
		locals: { locale: 'pt-BR' },
		request: { json: () => Promise.resolve(options.body ?? {}) }
	} as never;
}

async function response(handler: unknown, value: unknown) {
	return (handler as (event: unknown) => Response | Promise<Response>)(value);
}

describe('manual TMDB matching API', () => {
	beforeEach(() => {
		for (const mock of Object.values(h)) mock.mockReset();
		h.search.mockResolvedValue([
			{
				tmdbId: '550',
				mediaType: 'movie',
				title: 'Clube da Luta',
				originalTitle: 'Fight Club',
				year: 1999,
				overview: null,
				posterUrl: null
			}
		]);
		h.confirm.mockResolvedValue(ITEM);
		h.clear.mockResolvedValue({
			item: { ...ITEM, tmdbId: null, mediaType: null, manualMatchPinned: false },
			automaticResolution: { status: 'eligible' }
		});
		h.audit.mockResolvedValue([]);
	});

	it('searches an explicitly scoped item without invoking a mutation', async () => {
		const res = await response(SEARCH, event({ query: '?q=Fight%20Club&year=1999&type=both' }));
		expect(res.status).toBe(200);
		expect(h.search).toHaveBeenCalledWith('server-a', 7, {
			query: 'Fight Club',
			year: 1999,
			mediaType: 'both',
			language: 'pt-BR'
		});
		expect(h.confirm).not.toHaveBeenCalled();
		expect(h.clear).not.toHaveBeenCalled();
		expect((await res.json()).results).toHaveLength(1);
	});

	it('confirms a candidate using only id/type and returns the redacted resolution summary', async () => {
		const res = await response(
			PIN,
			event({ body: { tmdbId: '550', mediaType: 'movie', ignoredTitle: 'untrusted' } })
		);
		expect(res.status).toBe(200);
		expect(h.confirm).toHaveBeenCalledWith('server-a', 7, {
			tmdbId: '550',
			mediaType: 'movie',
			language: 'pt-BR'
		});
		expect(await res.json()).toEqual({ item: ITEM });
	});

	it('returns a structured conflict when remote identity no longer exists', async () => {
		h.confirm.mockRejectedValue(new ManualMatchError('tmdb_candidate_unavailable'));
		const res = await response(PIN, event({ body: { tmdbId: '550', mediaType: 'movie' } }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: { code: 'tmdb_candidate_unavailable' } });
	});

	it('returns scoped not-found without revealing an item from another server', async () => {
		h.search.mockRejectedValue(new ManualMatchError('media_item_not_found'));
		const res = await response(SEARCH, event({ serverId: 'server-b', query: '?q=Fight%20Club' }));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: { code: 'media_item_not_found' } });
	});

	it('clears explicitly and reports automatic-resolution disposition', async () => {
		const res = await response(CLEAR, event());
		expect(res.status).toBe(200);
		expect(h.clear).toHaveBeenCalledWith('server-a', 7);
		expect((await res.json()).automaticResolution.status).toBe('eligible');
	});

	it('exposes append-only audit entries through the same scope', async () => {
		h.audit.mockResolvedValue([{ id: 1, action: 'pinned', reason: 'manual' }]);
		const res = await response(AUDIT, event());
		expect(res.status).toBe(200);
		expect(h.audit).toHaveBeenCalledWith('server-a', 7);
		expect((await res.json()).entries).toEqual([{ id: 1, action: 'pinned', reason: 'manual' }]);
	});

	it('uses locale-neutral validation/internal errors without leaking exception messages', async () => {
		let res = await response(PIN, event({ body: { tmdbId: 550, mediaType: 'movie' } }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: { code: 'invalid_request' } });

		h.audit.mockRejectedValue(new Error('database URL included a secret'));
		res = await response(AUDIT, event());
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toMatchObject({ error: { code: 'internal_error' } });
		expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
		expect(JSON.stringify(body)).not.toContain('database URL');
	});
});

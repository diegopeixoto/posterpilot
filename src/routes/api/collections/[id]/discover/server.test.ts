import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	discoverForItem: vi.fn(),
	getCollection: vi.fn(),
	getActiveServerInstance: vi.fn(),
	resolveConfig: vi.fn(),
	logEvent: vi.fn(),
	dbWhere: vi.fn()
}));

vi.mock('$lib/server/posters/service', () => ({ discoverForItem: h.discoverForItem }));
vi.mock('$lib/server/posters/providers', () => ({
	PROVIDERS: [{ id: 'mediux' }, { id: 'fanarttv' }, { id: 'theposterdb' }, { id: 'tmdb' }]
}));
vi.mock('$lib/server/collections/queries', () => ({ getCollection: h.getCollection }));
vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.getActiveServerInstance
}));
vi.mock('$lib/server/config', () => ({ resolveConfig: h.resolveConfig }));
vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('$lib/server/db/schema', () => ({ mediaItems: {}, posterCandidates: {}, settings: {} }));
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: h.dbWhere
			})
		})
	}
}));

import { POST } from './+server';

function request(body: unknown) {
	return {
		params: { id: 'col-1' },
		request: new Request('http://localhost/api/collections/col-1/discover', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/collections/[id]/discover', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getActiveServerInstance.mockResolvedValue({ id: 'server-a' });
		h.getCollection.mockResolvedValue({
			localMembers: [{ id: 1 }, { id: 2 }]
		});
		h.resolveConfig.mockResolvedValue({});
		h.dbWhere.mockResolvedValue([
			{ id: 1, title: 'Batman Begins' },
			{ id: 2, title: 'The Dark Knight' }
		]);
		h.discoverForItem.mockResolvedValue(3);
	});

	it('re-discovers every local member with the requested providers', async () => {
		const response = await POST(request({ forceRefresh: true, providers: ['theposterdb'] }));
		expect(response.status).toBe(200);
		expect(h.discoverForItem).toHaveBeenCalledTimes(2);
		expect(h.discoverForItem).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ id: 1 }),
			expect.anything(),
			{ forceRefresh: true, providers: ['theposterdb'] }
		);
		expect(await response.json()).toEqual({ total: 2, succeeded: 2, failed: 0 });
	});

	it('spans every enabled provider when the body names none', async () => {
		// The collection page button sends no provider scope — discovery must fall through
		// to discoverForItem's own default (all enabled providers), not a hardcoded subset.
		await POST(request({ forceRefresh: true }));
		expect(h.discoverForItem).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			forceRefresh: true,
			providers: undefined
		});
	});

	it('drops unknown provider ids instead of passing them through', async () => {
		await POST(request({ providers: ['theposterdb', 'not-a-real-provider'] }));
		expect(h.discoverForItem).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			forceRefresh: undefined,
			providers: ['theposterdb']
		});
	});

	it('continues past a failing member and reports counts', async () => {
		h.discoverForItem.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('boom'));
		const response = await POST(request({}));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ total: 2, succeeded: 1, failed: 1 });
		expect(h.logEvent).toHaveBeenCalled();
	});

	it('404s when the collection is not found', async () => {
		h.getCollection.mockResolvedValue(null);
		await expect(POST(request({}))).rejects.toMatchObject({ status: 404 });
	});

	it('skips the discovery loop when there are no local members', async () => {
		h.getCollection.mockResolvedValue({ localMembers: [] });
		const response = await POST(request({}));
		expect(h.discoverForItem).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ total: 0, succeeded: 0, failed: 0 });
	});
});

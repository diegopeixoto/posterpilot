import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	discoverForItem: vi.fn(),
	getMediaItem: vi.fn(),
	getItemDetail: vi.fn(),
	getActiveServerInstance: vi.fn(),
	resolveConfig: vi.fn(),
	logEvent: vi.fn()
}));

vi.mock('$lib/server/posters/service', () => ({ discoverForItem: h.discoverForItem }));
vi.mock('$lib/server/posters/providers', () => ({
	PROVIDERS: [{ id: 'mediux' }, { id: 'fanarttv' }, { id: 'theposterdb' }, { id: 'tmdb' }]
}));
vi.mock('$lib/server/queries', () => ({
	getMediaItem: h.getMediaItem,
	getItemDetail: h.getItemDetail
}));
vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.getActiveServerInstance
}));
vi.mock('$lib/server/config', () => ({ resolveConfig: h.resolveConfig }));
vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));

import { POST } from './+server';

function request(body: unknown) {
	return {
		params: { id: '84' },
		request: new Request('http://localhost/api/items/84/discover', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/items/[id]/discover', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getActiveServerInstance.mockResolvedValue({ id: 'server-a' });
		h.getMediaItem.mockResolvedValue({ id: 84, title: 'Destination finale' });
		h.getItemDetail.mockResolvedValue({ candidates: [] });
		h.resolveConfig.mockResolvedValue({});
		h.discoverForItem.mockResolvedValue(3);
	});

	it('re-checks every provider by default', async () => {
		const response = await POST(request({}));
		expect(response.status).toBe(200);
		expect(h.discoverForItem).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			forceRefresh: undefined,
			providers: undefined
		});
	});

	it('scopes discovery to the requested provider and forces a refresh', async () => {
		const response = await POST(request({ forceRefresh: true, providers: ['theposterdb'] }));
		expect(response.status).toBe(200);
		expect(h.discoverForItem).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			forceRefresh: true,
			providers: ['theposterdb']
		});
	});

	it('drops unknown provider ids instead of passing them through', async () => {
		await POST(request({ providers: ['theposterdb', 'not-a-real-provider'] }));
		expect(h.discoverForItem).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			forceRefresh: undefined,
			providers: ['theposterdb']
		});
	});

	it('reports discovery_failed without crashing when discoverForItem throws', async () => {
		h.discoverForItem.mockRejectedValue(new Error('boom'));
		const response = await POST(request({}));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ count: 0, candidates: [], error: 'discovery_failed' });
		expect(h.logEvent).toHaveBeenCalled();
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	list: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.active
}));

vi.mock('$lib/server/artwork-revisions/history-runtime', () => ({
	listActiveItemArtworkRevisionHistory: h.list
}));

import { GET } from './+server';

function event(id: string, search = ''): Parameters<typeof GET>[0] {
	return {
		params: { id },
		url: new URL(`http://localhost/api/items/${id}/revisions${search}`)
	} as Parameters<typeof GET>[0];
}

describe('GET /api/items/[id]/revisions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.list.mockResolvedValue({
			item: { id: 4, type: 'show', title: 'Example' },
			entries: [],
			nextCursor: null
		});
	});

	it('binds item ownership and every filter to the active server read', async () => {
		const response = await GET(
			event('4', '?destination=kometa&kind=title_card&season=1&episode=2&group=group-1&limit=25')
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ item: { id: 4 }, entries: [] });
		expect(h.list).toHaveBeenCalledWith({
			serverInstanceId: 'server-a',
			mediaItemId: 4,
			query: {
				destination: 'kometa',
				kind: 'title_card',
				season: 1,
				episode: 2,
				groupId: 'group-1',
				limit: 25
			}
		});
	});

	it('does not reveal whether an item belongs to another server', async () => {
		h.list.mockResolvedValue(null);
		const response = await GET(event('4'));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: { code: 'item_not_found' } });
		expect(h.list).toHaveBeenCalledWith({
			serverInstanceId: 'server-a',
			mediaItemId: 4,
			query: { limit: 50 }
		});
	});

	it('returns a structured conflict when no active server exists', async () => {
		h.active.mockResolvedValue(null);
		const response = await GET(event('4'));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'server_instance_not_found' }
		});
		expect(h.list).not.toHaveBeenCalled();
	});

	it('rejects invalid item ids and bounded query inputs before reading history', async () => {
		const invalidId = await GET(event('0'));
		expect(invalidId.status).toBe(400);
		expect(await invalidId.json()).toEqual({
			error: { code: 'invalid_request', field: 'id' }
		});

		const invalidQuery = await GET(event('4', '?limit=101'));
		expect(invalidQuery.status).toBe(400);
		expect(await invalidQuery.json()).toEqual({
			error: { code: 'invalid_limit', field: 'limit' }
		});
		expect(h.list).not.toHaveBeenCalled();
	});
});

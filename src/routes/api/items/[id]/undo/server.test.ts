import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	preview: vi.fn(),
	confirm: vi.fn(),
	maintenance: vi.fn()
}));

vi.mock('$lib/server/artwork-revisions/undo-runtime', () => ({
	previewActiveItemArtworkUndo: h.preview,
	confirmActiveItemArtworkUndo: h.confirm
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: h.maintenance }));

import { parseActiveItemUndoScope } from '$lib/server/artwork-revisions/undo-http';
import { POST, PUT } from './+server';

const digest = 'a'.repeat(64);

function request(method: 'POST' | 'PUT', body?: unknown): Request {
	return new Request('http://localhost/api/items/7/undo', {
		method,
		...(body === undefined
			? {}
			: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
	});
}

describe('/api/items/[id]/undo exact preview and confirmation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.maintenance.mockImplementation(() => undefined);
		h.preview.mockResolvedValue({
			planId: 'undo-plan-1',
			digest,
			scope: { kind: 'item', serverInstanceId: 'server-a', mediaItemId: 7 },
			operations: [],
			summary: {
				operationCount: 1,
				actionableCount: 1,
				unavailableCount: 0,
				targetCount: 1,
				slotCount: 1,
				destinations: { server: 1, kometa: 0 },
				restoreStates: { present: 1, absent: 0, unavailable: 0 }
			}
		});
		h.confirm.mockResolvedValue({
			jobId: 42,
			planId: 'undo-plan-1',
			digest,
			operationCount: 1
		});
	});

	it('POST creates only a preview and defaults an empty body to item scope', async () => {
		const response = await POST({
			params: { id: '7' },
			request: request('POST')
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			preview: { planId: 'undo-plan-1', digest }
		});
		expect(h.preview).toHaveBeenCalledWith({ mediaItemId: 7, scope: { kind: 'item' } });
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('parses every active-item scope plus the legacy season form', () => {
		expect(parseActiveItemUndoScope({ scope: { kind: 'revision', revisionId: 'rev-1' } })).toEqual({
			kind: 'revision',
			revisionId: 'rev-1'
		});
		expect(
			parseActiveItemUndoScope({
				scope: {
					kind: 'slot',
					slot: { kind: 'title_card', season: 2, episode: 4 }
				}
			})
		).toEqual({ kind: 'slot', slot: { kind: 'title_card', season: 2, episode: 4 } });
		expect(parseActiveItemUndoScope({ season: 0 })).toEqual({ kind: 'season', season: 0 });
		expect(parseActiveItemUndoScope({ scope: 'destination', destination: 'kometa' })).toEqual({
			kind: 'destination',
			destination: 'kometa'
		});
		expect(parseActiveItemUndoScope({ scope: 'group', groupId: 'group-1' })).toEqual({
			kind: 'group',
			revisionGroupId: 'group-1'
		});
		expect(parseActiveItemUndoScope({ scope: 'item' })).toEqual({ kind: 'item' });
	});

	it('PUT confirms only the supplied plan identity and hands it to the worker', async () => {
		const response = await PUT({
			params: { id: '7' },
			request: request('PUT', { planId: 'undo-plan-1', digest })
		} as Parameters<typeof PUT>[0]);

		// The plan is consumed and enqueued, so confirmation reports the job to follow
		// rather than an outcome the request never waited for.
		expect(response.status).toBe(202);
		expect(await response.json()).toMatchObject({
			ok: true,
			job: { jobId: 42, planId: 'undo-plan-1', operationCount: 1 }
		});
		expect(h.confirm).toHaveBeenCalledWith({
			mediaItemId: 7,
			planId: 'undo-plan-1',
			digest
		});
	});

	it('maps stale/replay and wrong scope without exposing internal messages', async () => {
		for (const code of ['plan_stale', 'plan_consumed', 'plan_scope_mismatch']) {
			h.confirm.mockRejectedValueOnce(
				Object.assign(new Error('/secret/config.yml changed'), { code })
			);
			const response = await PUT({
				params: { id: '7' },
				request: request('PUT', { planId: 'undo-plan-1', digest })
			} as Parameters<typeof PUT>[0]);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: { code } });
		}
	});

	it('rejects malformed input and maintenance before calling the runtime', async () => {
		const invalid = await PUT({
			params: { id: '7' },
			request: request('PUT', { planId: 'undo-plan-1' })
		} as Parameters<typeof PUT>[0]);
		expect(invalid.status).toBe(400);

		h.maintenance.mockImplementation(() => {
			throw Object.assign(new Error('restore directory secret'), { code: 'maintenance_mode' });
		});
		const blocked = await POST({
			params: { id: '7' },
			request: request('POST', {})
		} as Parameters<typeof POST>[0]);
		expect(blocked.status).toBe(503);
		expect(await blocked.json()).toEqual({ error: { code: 'maintenance_mode' } });
		expect(h.preview).not.toHaveBeenCalled();
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('returns not-found for an item outside the active server scope', async () => {
		h.preview.mockRejectedValueOnce(
			Object.assign(new Error('item exists on server-b'), { code: 'item_not_found' })
		);
		const response = await POST({
			params: { id: '7' },
			request: request('POST', {})
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: { code: 'item_not_found' } });
	});
});

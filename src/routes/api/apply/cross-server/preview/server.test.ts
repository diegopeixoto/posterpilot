import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ preview: vi.fn() }));

vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$lib/server/plans/cross-server-apply-runtime', () => ({
	previewDatabaseCrossServerApply: h.preview
}));

import { POST } from './+server';

describe('POST /api/apply/cross-server/preview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.preview.mockResolvedValue({
			planId: 'cross-plan-1',
			digest: 'a'.repeat(64),
			context: {
				source: 'cross_server',
				destinationServerInstanceIds: ['server-b', 'server-c'],
				resolutions: [
					{ serverInstanceId: 'server-b', status: 'matched', candidateItemIds: [2] },
					{ serverInstanceId: 'server-c', status: 'not_found', candidateItemIds: [] }
				]
			}
		});
	});

	it('requires and forwards an explicit source, identifier, and named destination servers', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply/cross-server/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sourceItem: { serverInstanceId: 'server-a', mediaItemId: 1 },
					destinationServerInstanceIds: ['server-b', 'server-c'],
					match: { namespace: 'tmdb', value: '777' },
					selection: 'stored',
					method: 'server'
				})
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			planId: 'cross-plan-1',
			context: {
				resolutions: [
					{ serverInstanceId: 'server-b', status: 'matched' },
					{ serverInstanceId: 'server-c', status: 'not_found' }
				]
			}
		});
		expect(h.preview).toHaveBeenCalledWith({
			sourceItem: { serverInstanceId: 'server-a', mediaItemId: 1 },
			destinationServerInstanceIds: ['server-b', 'server-c'],
			match: { namespace: 'tmdb', value: '777' },
			selectionMode: 'stored',
			method: 'server'
		});
	});

	it('does not infer destinations or matching identity from omitted fields', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply/cross-server/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sourceItem: { serverInstanceId: 'server-a', mediaItemId: 1 },
					title: 'Same title'
				})
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'invalid_request' });
		expect(h.preview).not.toHaveBeenCalled();
	});
});

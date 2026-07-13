import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ confirm: vi.fn(), enqueue: vi.fn(), maintenance: vi.fn() }));

vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$lib/server/plans/cross-server-apply-runtime', () => ({
	confirmDatabaseCrossServerApply: h.confirm
}));
vi.mock('$lib/server/jobs/runner', () => ({ enqueueJob: h.enqueue }));
vi.mock('$lib/server/maintenance-http', () => ({ maintenanceResponse: h.maintenance }));

import { POST } from './+server';

describe('POST /api/apply/cross-server', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.maintenance.mockReturnValue(null);
		h.confirm.mockResolvedValue({ jobId: 51, planId: 'cross-plan-1', digest: 'b'.repeat(64) });
	});

	it('confirms only the exact plan with the same explicit source, identity, and destinations', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply/cross-server', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					planId: 'cross-plan-1',
					digest: 'b'.repeat(64),
					sourceItem: { serverInstanceId: 'server-a', mediaItemId: 1 },
					destinationServerInstanceIds: ['server-b', 'server-c'],
					match: { namespace: 'imdb', value: 'tt0000777' }
				})
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			jobId: 51,
			planId: 'cross-plan-1',
			digest: 'b'.repeat(64)
		});
		expect(h.confirm).toHaveBeenCalledWith(
			{
				planId: 'cross-plan-1',
				digest: 'b'.repeat(64),
				sourceItem: { serverInstanceId: 'server-a', mediaItemId: 1 },
				destinationServerInstanceIds: ['server-b', 'server-c'],
				match: { namespace: 'imdb', value: 'tt0000777' }
			},
			h.enqueue
		);
	});

	it('rejects legacy mutable input without exact confirmation scope', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply/cross-server', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemIds: [2], title: 'Same title', method: 'server' })
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'plan_confirmation_required' });
		expect(h.confirm).not.toHaveBeenCalled();
	});
});

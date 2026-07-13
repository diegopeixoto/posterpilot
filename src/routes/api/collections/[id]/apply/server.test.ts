import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	confirm: vi.fn(),
	assertFresh: vi.fn(),
	enqueue: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/collections/apply-scope', () => ({
	assertCollectionApplyContextFresh: h.assertFresh
}));
vi.mock('$lib/server/jobs/runner', () => ({ enqueueJobDetailed: h.enqueue }));
vi.mock('$lib/server/plans/apply-runtime', () => ({
	activeApplyServerInstanceId: h.active,
	confirmDatabaseArtworkApply: h.confirm
}));
vi.mock('$lib/server/plans/apply-route-error', () => ({
	applyRouteError: () => new Response(null, { status: 500 })
}));
vi.mock('$lib/server/maintenance-http', () => ({ maintenanceResponse: () => null }));

import { POST } from './+server';

function event(body: unknown) {
	return {
		params: { id: 'collection-a' },
		request: new Request('http://localhost/api/collections/collection-a/apply', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('/api/collections/[id]/apply', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue('server-a');
		h.enqueue.mockResolvedValue({ jobId: 44, reused: false });
		h.confirm.mockImplementation(async (_request, enqueue, options) => {
			await options.validateContext({ context: { source: 'collection' } });
			const jobId = await enqueue({ kind: 'apply' });
			return { jobId, planId: 'plan-a', digest: 'a'.repeat(64) };
		});
		h.assertFresh.mockResolvedValue(undefined);
	});

	it('binds confirmation to collection and active-server context freshness', async () => {
		const response = await POST(event({ planId: 'plan-a', digest: 'a'.repeat(64) }));
		expect(response.status).toBe(200);
		expect(h.confirm).toHaveBeenCalledWith(
			{ planId: 'plan-a', digest: 'a'.repeat(64), serverInstanceId: 'server-a' },
			expect.any(Function),
			expect.objectContaining({ validateContext: expect.any(Function) })
		);
		expect(h.assertFresh).toHaveBeenCalledWith(
			{},
			{ context: { source: 'collection' } },
			{ collectionId: 'collection-a', serverInstanceId: 'server-a' }
		);
		expect(h.enqueue).toHaveBeenCalledWith(
			{ kind: 'apply' },
			expect.objectContaining({
				persistedType: 'collection_apply',
				trigger: 'collection:collection-a'
			})
		);
	});

	it('requires an exact confirmation body', async () => {
		const response = await POST(event({ planId: 'plan-a', digest: 'a'.repeat(64), itemIds: [1] }));
		expect(response.status).toBe(400);
		expect(h.confirm).not.toHaveBeenCalled();
	});
});

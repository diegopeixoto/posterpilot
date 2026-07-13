import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	resolveTargets: vi.fn(),
	preview: vi.fn(),
	confirm: vi.fn(),
	enqueue: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$lib/server/plans/apply-runtime', () => ({
	activeApplyServerInstanceId: h.active,
	resolveDatabaseApplyTargets: h.resolveTargets,
	previewDatabaseArtworkApply: h.preview,
	confirmDatabaseArtworkApply: h.confirm
}));
vi.mock('$lib/server/jobs/runner', () => ({ enqueueJob: h.enqueue }));

import { POST } from './+server';

describe('POST /api/items/[id]/apply', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue('server-a');
		h.resolveTargets.mockResolvedValue([{ serverInstanceId: 'server-a', mediaItemId: 4 }]);
		h.preview.mockResolvedValue({
			planId: 'single-plan',
			digest: 'c'.repeat(64),
			summary: { operationCount: 2 },
			items: [{ target: { mediaItemId: 4 }, operations: [{ id: 'poster' }, { id: 'background' }] }]
		});
		h.confirm.mockResolvedValue({ jobId: 9, planId: 'single-plan', digest: 'c'.repeat(64) });
	});

	it('turns a legacy direct body into a safe preview and performs no enqueue', async () => {
		const response = await POST({
			params: { id: '4' },
			request: new Request('http://localhost/api/items/4/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ posterUrl: 'https://ignored.example/poster.jpg', method: 'both' })
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			planId: 'single-plan',
			items: [{ operations: [{ id: 'poster' }, { id: 'background' }] }]
		});
		expect(h.preview).toHaveBeenCalledWith({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 4 }],
			selectionMode: 'stored',
			method: 'both'
		});
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('binds confirmation to both active server and item URL', async () => {
		const response = await POST({
			params: { id: '4' },
			request: new Request('http://localhost/api/items/4/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: 'single-plan', digest: 'c'.repeat(64) })
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(h.confirm).toHaveBeenCalledWith(
			{
				planId: 'single-plan',
				digest: 'c'.repeat(64),
				serverInstanceId: 'server-a',
				targetItemId: 4
			},
			h.enqueue
		);
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ runSync: vi.fn() }));
vi.mock('$lib/server/kometa/sync', () => ({ runSync: h.runSync }));
vi.mock('$lib/server/plans/apply-route-error', () => ({
	applyRouteError: () => new Response(JSON.stringify({ error: 'failed' }), { status: 409 })
}));

import { POST } from './+server';

function req(body: unknown) {
	return { request: { json: () => Promise.resolve(body) } } as unknown as Parameters<
		typeof POST
	>[0];
}

describe('POST /api/kometa/config/sync', () => {
	beforeEach(() => h.runSync.mockReset());

	it('confirms an exact plan and returns its result', async () => {
		h.runSync.mockResolvedValue({
			active: true,
			exists: true,
			willScaffold: false,
			parseError: null,
			scaffolded: false,
			backup: true,
			changes: [],
			warnings: []
		});
		const res = await (POST as (e: unknown) => Promise<Response>)(
			req({ planId: 'plan-1', digest: 'a'.repeat(64) })
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		const body = (await res.json()) as { backup: boolean };
		expect(body.backup).toBe(true);
		expect(h.runSync).toHaveBeenCalledWith({ planId: 'plan-1', digest: 'a'.repeat(64) });
	});

	it('rejects legacy direct-selection writes before calling the service', async () => {
		const res = await (POST as (e: unknown) => Promise<Response>)(
			req({ libraries: ['1'], defaults: {}, settings: {} })
		);
		expect(res.status).toBe(409);
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		expect(await res.json()).toEqual({ error: 'preview_required' });
		expect(h.runSync).not.toHaveBeenCalled();
	});
});

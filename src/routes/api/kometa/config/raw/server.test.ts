import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	loadRaw: vi.fn(),
	previewRawConfig: vi.fn(),
	confirmRawConfig: vi.fn()
}));

vi.mock('$lib/server/kometa/sync', () => h);
vi.mock('$lib/server/plans/apply-route-error', () => ({
	applyRouteError: () => new Response(JSON.stringify({ error: 'failed' }), { status: 409 })
}));

import { GET, POST, PUT } from './+server';

function req(body: unknown) {
	return { request: { json: () => Promise.resolve(body) } } as unknown as Parameters<
		typeof POST
	>[0];
}

describe('/api/kometa/config/raw exact plan flow', () => {
	beforeEach(() => vi.clearAllMocks());

	it('GET returns the sensitive raw file with private no-store caching', async () => {
		h.loadRaw.mockResolvedValue({ active: true, text: 'webhooks:\n  error: secret\n' });
		const response = await (GET as () => Promise<Response>)();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('POST creates a preview and never calls confirmation', async () => {
		h.previewRawConfig.mockResolvedValue({
			ok: true,
			parseError: null,
			planId: 'plan-raw',
			digest: 'a'.repeat(64),
			changes: []
		});
		const response = await (POST as (event: unknown) => Promise<Response>)(req({ text: 'a: 1' }));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.previewRawConfig).toHaveBeenCalledWith('a: 1');
		expect(h.confirmRawConfig).not.toHaveBeenCalled();
	});

	it('PUT requires and confirms only a plan id plus digest', async () => {
		h.confirmRawConfig.mockResolvedValue({ ok: true, parseError: null, backup: true });
		const response = await (PUT as (event: unknown) => Promise<Response>)(
			req({ planId: 'plan-raw', digest: 'b'.repeat(64), text: 'ignored' })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.confirmRawConfig).toHaveBeenCalledWith({
			planId: 'plan-raw',
			digest: 'b'.repeat(64)
		});
	});

	it('PUT rejects a direct content write without a preview', async () => {
		const response = await (PUT as (event: unknown) => Promise<Response>)(req({ text: 'a: 2' }));
		expect(response.status).toBe(409);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.confirmRawConfig).not.toHaveBeenCalled();
	});
});

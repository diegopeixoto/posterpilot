import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	previewRestoreConfig: vi.fn(),
	confirmRestoreConfig: vi.fn()
}));

vi.mock('$lib/server/kometa/sync', () => h);
vi.mock('$lib/server/plans/apply-route-error', () => ({
	applyRouteError: () => new Response(JSON.stringify({ error: 'failed' }), { status: 409 })
}));

import { POST, PUT } from './+server';

function req(body: unknown) {
	return { request: { json: () => Promise.resolve(body) } } as unknown as Parameters<
		typeof POST
	>[0];
}

describe('/api/kometa/config/restore exact plan flow', () => {
	beforeEach(() => vi.clearAllMocks());

	it('previews a named backup without restoring it', async () => {
		h.previewRestoreConfig.mockResolvedValue({
			ok: true,
			parseError: null,
			planId: 'plan-restore',
			digest: 'c'.repeat(64)
		});
		const response = await (POST as (event: unknown) => Promise<Response>)(
			req({ name: 'config.yml.posterpilot-bak-one' })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.previewRestoreConfig).toHaveBeenCalledWith('config.yml.posterpilot-bak-one');
		expect(h.confirmRestoreConfig).not.toHaveBeenCalled();
	});

	it('confirms only the previously issued plan', async () => {
		h.confirmRestoreConfig.mockResolvedValue({ ok: true, parseError: null, backup: true });
		const response = await (PUT as (event: unknown) => Promise<Response>)(
			req({ planId: 'plan-restore', digest: 'd'.repeat(64) })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.confirmRestoreConfig).toHaveBeenCalledWith({
			planId: 'plan-restore',
			digest: 'd'.repeat(64)
		});
	});
});

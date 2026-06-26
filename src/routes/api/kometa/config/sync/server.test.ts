import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ runSync: vi.fn() }));
vi.mock('$lib/server/kometa/sync', () => ({ runSync: h.runSync }));

import { POST } from './+server';

function req(body: unknown) {
	return { request: { json: () => Promise.resolve(body) } } as unknown as Parameters<
		typeof POST
	>[0];
}

describe('POST /api/kometa/config/sync', () => {
	beforeEach(() => h.runSync.mockReset());

	it('delegates to runSync and returns its result', async () => {
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
			req({ libraries: ['1'], defaults: {}, settings: {} })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { backup: boolean };
		expect(body.backup).toBe(true);
		expect(h.runSync).toHaveBeenCalledWith({ libraries: ['1'], defaults: {}, settings: {} });
	});

	it('surfaces a parse error from runSync without throwing', async () => {
		h.runSync.mockResolvedValue({
			active: true,
			exists: true,
			willScaffold: false,
			parseError: 'bad yaml at line 3',
			changes: [],
			warnings: []
		});
		const res = await (POST as (e: unknown) => Promise<Response>)(req({}));
		const body = (await res.json()) as { parseError: string };
		expect(body.parseError).toBe('bad yaml at line 3');
	});
});

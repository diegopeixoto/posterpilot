import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ previewSync: vi.fn() }));
vi.mock('$lib/server/kometa/sync', () => ({ previewSync: h.previewSync }));

import { POST } from './+server';

function req(body: unknown) {
	return { request: { json: () => Promise.resolve(body) } } as unknown as Parameters<
		typeof POST
	>[0];
}

describe('POST /api/kometa/config/preview', () => {
	beforeEach(() => h.previewSync.mockReset());

	it('parses the body and returns the redacted preview without writing', async () => {
		h.previewSync.mockResolvedValue({
			active: true,
			exists: true,
			willScaffold: false,
			parseError: null,
			changes: [{ op: 'modify', path: 'plex.token', before: '***', after: '***' }],
			warnings: []
		});
		const res = await (POST as (e: unknown) => Promise<Response>)(
			req({ libraries: ['1'], defaults: { '1': ['genre'] }, settings: {} })
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		const body = (await res.json()) as { changes: { path: string; after: string }[] };
		expect(body.changes[0].after).toBe('***');
		// preview delegates to previewSync with the parsed selection (never runSync).
		expect(h.previewSync).toHaveBeenCalledWith(
			expect.objectContaining({ libraries: ['1'], defaults: { '1': ['genre'] } })
		);
	});
});

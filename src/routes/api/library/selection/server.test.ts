import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class LibrarySelectionError extends Error {
		constructor(
			public readonly code: 'invalid_request' | 'no_active_server' | 'result_set_changed'
		) {
			super(code);
		}
	}

	return {
		materializeSelection: vi.fn(),
		LibrarySelectionError
	};
});

vi.mock('$lib/server/library-selection', () => ({
	LibrarySelectionError: h.LibrarySelectionError,
	materializeLibrarySelection: h.materializeSelection
}));

import { GET } from './+server';

describe('GET /api/library/selection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.materializeSelection.mockResolvedValue({
			serverInstanceId: 'server-a',
			itemIds: [1, 2, 3],
			count: 3,
			fingerprint: 'selection-v1'
		});
	});

	it('returns only the exact result count and fingerprint', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/library/selection?type=movie&sort=title')
		} as Parameters<typeof GET>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ count: 3, fingerprint: 'selection-v1' });
		expect(h.materializeSelection).toHaveBeenCalledWith('?type=movie&sort=title');
	});

	it('reports that no active server can own the selection', async () => {
		h.materializeSelection.mockRejectedValue(new h.LibrarySelectionError('no_active_server'));

		const response = await GET({
			url: new URL('http://localhost/api/library/selection')
		} as Parameters<typeof GET>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: { code: 'no_active_server' } });
	});
});

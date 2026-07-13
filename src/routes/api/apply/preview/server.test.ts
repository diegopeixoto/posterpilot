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
		active: vi.fn(),
		resolveTargets: vi.fn(),
		preview: vi.fn(),
		materializeSelection: vi.fn(),
		LibrarySelectionError
	};
});

vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$lib/server/plans/apply-runtime', () => ({
	activeApplyServerInstanceId: h.active,
	resolveDatabaseApplyTargets: h.resolveTargets,
	previewDatabaseArtworkApply: h.preview
}));

vi.mock('$lib/server/library-selection', () => ({
	LibrarySelectionError: h.LibrarySelectionError,
	materializeLibrarySelection: h.materializeSelection
}));

import { POST } from './+server';

describe('POST /api/apply/preview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue('server-a');
		h.resolveTargets.mockResolvedValue([
			{ serverInstanceId: 'server-a', mediaItemId: 1 },
			{ serverInstanceId: 'server-a', mediaItemId: 2 }
		]);
		h.preview.mockResolvedValue({
			planId: 'plan-1',
			digest: 'a'.repeat(64),
			expiresAt: '2026-07-10T12:15:00.000Z',
			summary: { operationCount: 3 },
			items: [{ target: { mediaItemId: 1 }, operations: [{ id: 'op-1' }], skips: [] }]
		});
		h.materializeSelection.mockResolvedValue({
			serverInstanceId: 'server-a',
			itemIds: [3, 4, 5],
			count: 3,
			fingerprint: 'exact-filter-v2'
		});
	});

	it('returns the exact confirmation-bearing planner response', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					itemIds: [1, 2],
					method: 'both',
					selection: 'auto',
					resultSetFingerprint: 'filter-v1'
				})
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			planId: 'plan-1',
			digest: 'a'.repeat(64),
			items: [{ operations: [{ id: 'op-1' }] }]
		});
		expect(h.resolveTargets).toHaveBeenCalledWith([1, 2], 'server-a');
		expect(h.preview).toHaveBeenCalledWith({
			context: { source: 'bulk', resultSetFingerprint: 'filter-v1' },
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 1 },
				{ serverInstanceId: 'server-a', mediaItemId: 2 }
			],
			selectionMode: 'auto',
			method: 'both'
		});
	});

	it('rematerializes an all-matching selection and binds the plan to its exact fingerprint', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					selectionScope: {
						query: '?sort=title&state=needs_review',
						fingerprint: 'exact-filter-v2'
					},
					method: 'server',
					selection: 'stored'
				})
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(h.materializeSelection).toHaveBeenCalledWith(
			'?sort=title&state=needs_review',
			'exact-filter-v2'
		);
		expect(h.resolveTargets).toHaveBeenCalledWith([3, 4, 5], 'server-a');
		expect(h.preview).toHaveBeenCalledWith({
			context: { source: 'bulk', resultSetFingerprint: 'exact-filter-v2' },
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 1 },
				{ serverInstanceId: 'server-a', mediaItemId: 2 }
			],
			selectionMode: 'stored',
			method: 'server'
		});
	});
});

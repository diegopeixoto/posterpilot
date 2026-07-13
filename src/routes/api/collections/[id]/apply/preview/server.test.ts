import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	loadScope: vi.fn(),
	resolveTargets: vi.fn(),
	preview: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/collections/apply-scope', () => ({
	CollectionApplyScopeError: class CollectionApplyScopeError extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	},
	loadCollectionApplyScope: h.loadScope
}));
vi.mock('$lib/server/plans/apply-runtime', () => ({
	activeApplyServerInstanceId: h.active,
	resolveDatabaseApplyTargets: h.resolveTargets,
	previewDatabaseArtworkApply: h.preview
}));
vi.mock('$lib/server/plans/apply-route-error', () => ({
	applyRouteError: () => new Response(null, { status: 500 })
}));

import { POST } from './+server';

function event(body: unknown) {
	return {
		params: { id: 'collection-a' },
		request: new Request('http://localhost/api/collections/collection-a/apply/preview', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('/api/collections/[id]/apply/preview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue('server-a');
		h.loadScope.mockResolvedValue({
			collectionId: 'collection-a',
			serverInstanceId: 'server-a',
			itemIds: [2, 5],
			membershipFingerprint: 'fingerprint-a'
		});
		h.resolveTargets.mockResolvedValue([
			{ serverInstanceId: 'server-a', mediaItemId: 2 },
			{ serverInstanceId: 'server-a', mediaItemId: 5 }
		]);
		h.preview.mockResolvedValue({ planId: 'plan-a', digest: 'digest-a' });
	});

	it('previews stored selections for the exact active-server membership', async () => {
		const response = await POST(event({ method: 'server' }));
		expect(response.status).toBe(200);
		expect(h.loadScope).toHaveBeenCalledWith({}, 'server-a', 'collection-a', {
			requireLocalMembers: true
		});
		expect(h.preview).toHaveBeenCalledWith({
			context: {
				source: 'collection',
				collectionId: 'collection-a',
				membershipFingerprint: 'fingerprint-a'
			},
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 2 },
				{ serverInstanceId: 'server-a', mediaItemId: 5 }
			],
			selectionMode: 'stored',
			method: 'server'
		});
	});

	it('rejects unexpected fields before planning', async () => {
		const response = await POST(event({ method: 'server', itemIds: [99] }));
		expect(response.status).toBe(400);
		expect(h.preview).not.toHaveBeenCalled();
	});
});

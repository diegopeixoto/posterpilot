import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	getGroup: vi.fn(),
	getRevision: vi.fn(),
	preview: vi.fn(),
	confirm: vi.fn(),
	validatePlan: vi.fn(),
	assertPlan: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));
vi.mock('$lib/server/collections/history-runtime', () => ({
	collectionHistory: { get: h.getGroup, getRevision: h.getRevision }
}));
vi.mock('$lib/server/artwork-revisions/undo-runtime', () => ({
	previewActiveItemArtworkUndo: h.preview,
	confirmActiveItemArtworkUndo: h.confirm
}));
vi.mock('$lib/server/artwork-revisions/undo-plan', () => ({
	UNDO_PLAN_KIND: 'artwork_undo',
	assertUndoPlanPayload: h.assertPlan
}));
vi.mock('$lib/server/plans/operation-plan-store', () => ({
	operationPlanStore: { validate: h.validatePlan }
}));

import { POST, PUT } from './+server';

function event(method: 'POST' | 'PUT', body: unknown) {
	return {
		params: { id: 'collection-a' },
		request: new Request('http://localhost/api/collections/collection-a/undo', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('/api/collections/[id]/undo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.getGroup.mockResolvedValue({ id: 'group-a', anchorItemId: 7 });
		h.getRevision.mockResolvedValue({
			group: { id: 'group-a', anchorItemId: 7 },
			revision: { id: 'revision-a', mediaItemId: 7, restorable: true }
		});
		h.preview.mockResolvedValue({
			planId: 'undo-a',
			digest: 'a'.repeat(64),
			summary: { actionableCount: 2 }
		});
		h.validatePlan.mockResolvedValue({
			payload: {
				scope: {
					kind: 'group',
					serverInstanceId: 'server-a',
					revisionGroupId: 'group-a'
				}
			}
		});
		h.confirm.mockResolvedValue({
			jobId: 42,
			planId: 'undo-a',
			digest: 'a'.repeat(64),
			operationCount: 2
		});
	});

	it('previews only a revision group bound to the active collection', async () => {
		const response = await POST(event('POST', { revisionGroupId: 'group-a' }));
		expect(response.status).toBe(200);
		expect(h.getGroup).toHaveBeenCalledWith('server-a', 'collection-a', 'group-a');
		expect(h.preview).toHaveBeenCalledWith({
			mediaItemId: 7,
			scope: { kind: 'group', revisionGroupId: 'group-a' }
		});
	});

	it('previews one restorable member revision bound to the active collection', async () => {
		const response = await POST(event('POST', { revisionId: 'revision-a' }));
		expect(response.status).toBe(200);
		expect(h.getRevision).toHaveBeenCalledWith('server-a', 'collection-a', 'revision-a');
		expect(h.preview).toHaveBeenCalledWith({
			mediaItemId: 7,
			scope: { kind: 'revision', revisionId: 'revision-a' }
		});
	});

	it('confirms the same single-use group undo plan through its anchor item', async () => {
		const response = await PUT(
			event('PUT', { planId: 'undo-a', digest: 'a'.repeat(64) }) as Parameters<typeof PUT>[0]
		);
		// A grouped undo may span every member, so it is handed to the durable worker.
		expect(response.status).toBe(202);
		expect(await response.json()).toMatchObject({ ok: true, job: { jobId: 42 } });
		expect(h.validatePlan).toHaveBeenCalledWith('undo-a', {
			kind: 'artwork_undo',
			digest: 'a'.repeat(64),
			serverInstanceId: 'server-a'
		});
		expect(h.confirm).toHaveBeenCalledWith({
			mediaItemId: 7,
			planId: 'undo-a',
			digest: 'a'.repeat(64)
		});
	});

	it('confirms a single-use member revision undo through the exact member anchor', async () => {
		h.validatePlan.mockResolvedValue({
			payload: {
				scope: {
					kind: 'revision',
					serverInstanceId: 'server-a',
					revisionId: 'revision-a'
				}
			}
		});
		const response = await PUT(
			event('PUT', { planId: 'undo-a', digest: 'a'.repeat(64) }) as Parameters<typeof PUT>[0]
		);
		expect(response.status).toBe(202);
		expect(h.getRevision).toHaveBeenCalledWith('server-a', 'collection-a', 'revision-a');
		expect(h.confirm).toHaveBeenCalledWith({
			mediaItemId: 7,
			planId: 'undo-a',
			digest: 'a'.repeat(64)
		});
	});

	it('rejects ambiguous group plus revision preview input', async () => {
		const response = await POST(
			event('POST', { revisionGroupId: 'group-a', revisionId: 'revision-a' })
		);
		expect(response.status).toBe(400);
		expect(h.preview).not.toHaveBeenCalled();
	});

	it('rejects a group from another collection without disclosing it', async () => {
		h.getGroup.mockResolvedValue(null);
		const response = await POST(event('POST', { revisionGroupId: 'group-other' }));
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'collection_action_not_found' }
		});
		expect(h.preview).not.toHaveBeenCalled();
	});
});

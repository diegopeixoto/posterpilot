import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	preview: vi.fn(),
	confirm: vi.fn(),
	maintenance: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { MAX_UPLOAD_MB: '1' } }));
vi.mock('$lib/server/artwork-revisions/custom-upload-runtime', () => ({
	previewActiveCustomUpload: h.preview,
	confirmActiveCustomUpload: h.confirm
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: h.maintenance }));

import { POST, PUT } from './+server';

function jpeg(): Uint8Array {
	return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 0, 0, 0, 0, 0, 0, 0);
}

function request(method: 'POST' | 'PUT', options: { planId?: string; digest?: string } = {}) {
	const form = new FormData();
	const image = jpeg();
	const body = image.buffer.slice(
		image.byteOffset,
		image.byteOffset + image.byteLength
	) as ArrayBuffer;
	form.set('file', new File([body], 'poster.jpg', { type: 'application/octet-stream' }));
	if (options.planId) form.set('planId', options.planId);
	if (options.digest) form.set('digest', options.digest);
	return new Request('http://localhost/api/items/7/upload', { method, body: form });
}

describe('/api/items/[id]/upload exact preview and confirm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.maintenance.mockImplementation(() => undefined);
		h.preview.mockResolvedValue({
			planId: 'upload-plan-1',
			digest: 'a'.repeat(64),
			expiresAt: '2026-07-11T15:15:00.000Z',
			target: { serverInstanceId: 'server-a', mediaItemId: 7, targetId: 'target-7' },
			slot: { kind: 'poster', season: null, episode: null },
			image: { sha256: 'b'.repeat(64), contentType: 'image/jpeg', sizeBytes: 12 },
			currentFingerprint: 'c'.repeat(64)
		});
		h.confirm.mockResolvedValue({
			ok: true,
			planId: 'upload-plan-1',
			digest: 'a'.repeat(64),
			groupId: 'group-1',
			revisionId: 'revision-1',
			status: 'success',
			verification: 'exact',
			errorCode: null,
			observedFingerprint: 'b'.repeat(64),
			artworkVersion: 1
		});
	});

	it('POST returns a byte-free preview and never calls confirmation', async () => {
		const response = await POST({
			params: { id: '7' },
			request: request('POST')
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({
			ok: true,
			preview: {
				planId: 'upload-plan-1',
				target: { serverInstanceId: 'server-a', mediaItemId: 7 },
				image: { contentType: 'image/jpeg', sizeBytes: 12 }
			}
		});
		expect(body.preview).not.toHaveProperty('bytes');
		expect(h.preview).toHaveBeenCalledWith({
			mediaItemId: 7,
			bytes: expect.any(ArrayBuffer),
			contentType: 'image/jpeg',
			maxSizeBytes: 1024 * 1024
		});
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('PUT sends the same multipart bytes with the plan identity to confirmation', async () => {
		const response = await PUT({
			params: { id: '7' },
			request: request('PUT', { planId: 'upload-plan-1', digest: 'a'.repeat(64) })
		} as Parameters<typeof PUT>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			result: { verification: 'exact', artworkVersion: 1 }
		});
		expect(h.confirm).toHaveBeenCalledWith({
			mediaItemId: 7,
			planId: 'upload-plan-1',
			digest: 'a'.repeat(64),
			bytes: expect.any(ArrayBuffer),
			contentType: 'image/jpeg',
			sizeBytes: 12,
			maxSizeBytes: 1024 * 1024
		});
	});

	it('returns a structured verification failure without raw error text', async () => {
		h.confirm.mockResolvedValue({
			ok: false,
			planId: 'upload-plan-1',
			digest: 'a'.repeat(64),
			groupId: 'group-1',
			revisionId: 'revision-1',
			status: 'failed',
			verification: 'mismatch',
			errorCode: 'artwork_unchanged_after_write',
			observedFingerprint: 'c'.repeat(64),
			artworkVersion: 0
		});
		const response = await PUT({
			params: { id: '7' },
			request: request('PUT', { planId: 'upload-plan-1', digest: 'a'.repeat(64) })
		} as Parameters<typeof PUT>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			ok: false,
			error: { code: 'artwork_unchanged_after_write' },
			result: { verification: 'mismatch' }
		});
	});

	it('maps replay and wrong scope to locale-neutral conflicts', async () => {
		h.confirm.mockRejectedValueOnce(
			Object.assign(new Error('sensitive internal detail'), { code: 'plan_consumed' })
		);
		const replay = await PUT({
			params: { id: '7' },
			request: request('PUT', { planId: 'upload-plan-1', digest: 'a'.repeat(64) })
		} as Parameters<typeof PUT>[0]);
		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual({ error: { code: 'plan_consumed' } });

		h.preview.mockRejectedValueOnce(
			Object.assign(new Error('item exists on server-b'), { code: 'scope_mismatch' })
		);
		const scope = await POST({
			params: { id: '7' },
			request: request('POST')
		} as Parameters<typeof POST>[0]);
		expect(scope.status).toBe(409);
		expect(await scope.json()).toEqual({ error: { code: 'scope_mismatch' } });
	});

	it('blocks both phases during maintenance before touching the runtime', async () => {
		h.maintenance.mockImplementation(() => {
			throw Object.assign(new Error('restore path secret'), { code: 'maintenance_mode' });
		});
		const preview = await POST({
			params: { id: '7' },
			request: request('POST')
		} as Parameters<typeof POST>[0]);
		const confirm = await PUT({
			params: { id: '7' },
			request: request('PUT', { planId: 'upload-plan-1', digest: 'a'.repeat(64) })
		} as Parameters<typeof PUT>[0]);

		expect(preview.status).toBe(503);
		expect(confirm.status).toBe(503);
		expect(await preview.json()).toEqual({ error: { code: 'maintenance_mode' } });
		expect(await confirm.json()).toEqual({ error: { code: 'maintenance_mode' } });
		expect(h.preview).not.toHaveBeenCalled();
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('rejects malformed confirmation before runtime execution', async () => {
		const response = await PUT({
			params: { id: '7' },
			request: request('PUT')
		} as Parameters<typeof PUT>[0]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
		expect(h.confirm).not.toHaveBeenCalled();
	});
});

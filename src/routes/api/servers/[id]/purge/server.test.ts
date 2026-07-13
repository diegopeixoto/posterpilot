import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	preview: vi.fn(),
	confirm: vi.fn(),
	maintenance: vi.fn()
}));

vi.mock('$lib/server/server-instances/purge-runtime', () => ({
	previewServerPurge: h.preview,
	confirmServerPurge: h.confirm
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: h.maintenance }));

import { DELETE, POST } from './+server';

function deleteEvent(body: unknown, id = 'server-a'): Parameters<typeof DELETE>[0] {
	return {
		params: { id },
		request: new Request(`http://localhost/api/servers/${id}/purge`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof DELETE>[0];
}

describe('/api/servers/[id]/purge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.maintenance.mockImplementation(() => undefined);
		h.preview.mockResolvedValue({
			planId: 'purge-plan-1',
			digest: 'a'.repeat(64),
			expiresAt: '2026-07-11T18:15:00.000Z',
			server: {
				id: 'server-a',
				name: 'Disconnected A',
				type: 'plex',
				disconnectedAt: '2026-07-11T18:00:00.000Z'
			},
			impact: { items: 10, jobs: 2, revisions: 4, activeMutatingJobs: 0 },
			blocked: false,
			backupRecommended: true
		});
		h.confirm.mockResolvedValue({
			serverInstanceId: 'server-a',
			impact: { items: 10, jobs: 2, revisions: 4 },
			activeServerId: 'server-b',
			snapshotFilesReleased: 2,
			snapshotFilesReleaseFailed: 0
		});
	});

	it('POST returns the exact non-mutating impact preview', async () => {
		const response = await POST({ params: { id: 'server-a' } } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			preview: {
				planId: 'purge-plan-1',
				server: { id: 'server-a' },
				impact: { items: 10, jobs: 2, revisions: 4 },
				backupRecommended: true
			}
		});
		expect(h.preview).toHaveBeenCalledWith('server-a');
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('DELETE requires additional confirmation and binds plan to the path server', async () => {
		const response = await DELETE(
			deleteEvent({ confirm: true, planId: 'purge-plan-1', digest: 'a'.repeat(64) })
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			result: { serverInstanceId: 'server-a', activeServerId: 'server-b' }
		});
		expect(h.confirm).toHaveBeenCalledWith({
			serverInstanceId: 'server-a',
			planId: 'purge-plan-1',
			digest: 'a'.repeat(64)
		});
	});

	it('rejects missing explicit confirmation before calling the service', async () => {
		const response = await DELETE(deleteEvent({ planId: 'purge-plan-1', digest: 'a'.repeat(64) }));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('maps active jobs, stale plans, and replay to locale-neutral conflicts', async () => {
		for (const code of ['server_purge_active_jobs', 'server_purge_stale', 'plan_consumed']) {
			h.confirm.mockRejectedValueOnce(
				Object.assign(new Error(`secret details for ${code}`), { code })
			);
			const response = await DELETE(
				deleteEvent({ confirm: true, planId: 'purge-plan-1', digest: 'a'.repeat(64) })
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: { code } });
		}
	});

	it('blocks preview and confirmation during maintenance', async () => {
		h.maintenance.mockImplementation(() => {
			throw Object.assign(new Error('restore internals'), { code: 'maintenance_mode' });
		});
		const preview = await POST({ params: { id: 'server-a' } } as Parameters<typeof POST>[0]);
		const confirmation = await DELETE(
			deleteEvent({ confirm: true, planId: 'purge-plan-1', digest: 'a'.repeat(64) })
		);

		expect(preview.status).toBe(503);
		expect(confirmation.status).toBe(503);
		expect(await preview.json()).toEqual({ error: { code: 'maintenance_mode' } });
		expect(await confirmation.json()).toEqual({ error: { code: 'maintenance_mode' } });
		expect(h.preview).not.toHaveBeenCalled();
		expect(h.confirm).not.toHaveBeenCalled();
	});
});

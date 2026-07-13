import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	update: vi.fn(),
	setEnabled: vi.fn(),
	remove: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));
vi.mock('$lib/server/automation/runtime', () => ({
	automationStore: {
		update: h.update,
		setEnabled: h.setEnabled,
		remove: h.remove
	}
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: vi.fn() }));

import { DELETE, PATCH, PUT } from './+server';

function event(method: string, body: unknown) {
	return {
		params: { id: 'automation-a' },
		request: new Request('http://localhost/api/automations/automation-a', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof PUT>[0];
}

describe('/api/automations/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.update.mockResolvedValue({ id: 'automation-a', serverInstanceId: 'server-a' });
		h.setEnabled.mockResolvedValue({ id: 'automation-a', enabled: false });
		h.remove.mockResolvedValue(undefined);
	});

	it('binds full updates to the active server', async () => {
		const response = await PUT(
			event('PUT', {
				name: 'Changed',
				enabled: true,
				serverInstanceId: 'server-b',
				timezone: 'UTC',
				timing: { triggerType: 'daily', localTime: '08:00' },
				libraryScopes: ['movies']
			})
		);
		expect(response.status).toBe(200);
		expect(h.update).toHaveBeenCalledWith(
			'automation-a',
			'server-a',
			expect.objectContaining({ serverInstanceId: 'server-a' })
		);
	});

	it('accepts only an exact enabled toggle', async () => {
		const response = await PATCH(event('PATCH', { enabled: false }) as Parameters<typeof PATCH>[0]);
		expect(response.status).toBe(200);
		expect(h.setEnabled).toHaveBeenCalledWith('automation-a', 'server-a', false);

		const invalid = await PATCH(
			event('PATCH', { enabled: true, serverInstanceId: 'server-b' }) as Parameters<typeof PATCH>[0]
		);
		expect(invalid.status).toBe(400);
	});

	it('requires an explicit deletion confirmation', async () => {
		const rejected = await DELETE(
			event('DELETE', { confirm: false }) as Parameters<typeof DELETE>[0]
		);
		expect(rejected.status).toBe(400);
		expect(h.remove).not.toHaveBeenCalled();

		const response = await DELETE(
			event('DELETE', { confirm: true }) as Parameters<typeof DELETE>[0]
		);
		expect(response.status).toBe(200);
		expect(h.remove).toHaveBeenCalledWith('automation-a', 'server-a');
	});
});

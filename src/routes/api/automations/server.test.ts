import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	list: vi.fn(),
	history: vi.fn(),
	create: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));
vi.mock('$lib/server/automation/runtime', () => ({
	automationStore: { list: h.list, history: h.history, create: h.create }
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: vi.fn() }));

import { GET, POST } from './+server';

function getEvent(search = '') {
	return { url: new URL(`http://localhost/api/automations${search}`) } as Parameters<typeof GET>[0];
}

function postEvent(body: unknown) {
	return {
		request: new Request('http://localhost/api/automations', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('/api/automations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.list.mockResolvedValue([{ id: 'automation-a' }]);
		h.history.mockResolvedValue([{ id: 'occurrence-a' }]);
		h.create.mockResolvedValue({ id: 'automation-a', serverInstanceId: 'server-a' });
	});

	it('lists only the active server scope with bounded history', async () => {
		const response = await GET(getEvent('?historyLimit=25'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			schedules: [{ id: 'automation-a' }],
			occurrences: [{ id: 'occurrence-a' }]
		});
		expect(h.list).toHaveBeenCalledWith('server-a');
		expect(h.history).toHaveBeenCalledWith('server-a', 25);
	});

	it('returns an empty scoped view before the first server is configured', async () => {
		h.active.mockResolvedValue(null);
		const response = await GET(getEvent());
		expect(await response.json()).toEqual({ schedules: [], occurrences: [] });
		expect(h.list).not.toHaveBeenCalled();
	});

	it('overrides any crafted server id with the active server', async () => {
		const response = await POST(
			postEvent({
				name: 'Review',
				enabled: true,
				serverInstanceId: 'server-b',
				timezone: 'UTC',
				timing: { triggerType: 'interval', intervalMinutes: 60 },
				libraryScopes: ['movies']
			})
		);
		expect(response.status).toBe(201);
		expect(h.create).toHaveBeenCalledWith(
			expect.objectContaining({ serverInstanceId: 'server-a' })
		);
	});

	it('rejects malformed JSON without invoking persistence', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/automations', {
				method: 'POST',
				body: '{'
			})
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(h.create).not.toHaveBeenCalled();
	});
});

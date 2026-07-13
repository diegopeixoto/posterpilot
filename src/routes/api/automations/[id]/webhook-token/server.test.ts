import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	rotate: vi.fn(),
	clear: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));
vi.mock('$lib/server/automation/runtime', () => ({
	automationStore: { rotateWebhookToken: h.rotate, clearWebhookToken: h.clear }
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: vi.fn() }));

import { DELETE, POST } from './+server';

function event() {
	return {
		params: { id: 'automation-a' },
		url: new URL('https://posterpilot.test/api/automations/automation-a/webhook-token')
	} as Parameters<typeof POST>[0];
}

describe('/api/automations/[id]/webhook-token', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.rotate.mockResolvedValue({ token: 'secret-token' });
		h.clear.mockResolvedValue(undefined);
	});

	it('rotates a token only inside the active server and returns it once without caching', async () => {
		const response = await POST(event());
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(h.rotate).toHaveBeenCalledWith('automation-a', 'server-a');
		expect(await response.json()).toEqual({
			token: 'secret-token',
			endpoint: 'https://posterpilot.test/api/automation-webhooks/automation-a',
			header: 'X-PosterPilot-Webhook-Token'
		});
	});

	it('clears only the active-server token', async () => {
		const response = await DELETE(event() as Parameters<typeof DELETE>[0]);
		expect(response.status).toBe(200);
		expect(h.clear).toHaveBeenCalledWith('automation-a', 'server-a');
	});
});

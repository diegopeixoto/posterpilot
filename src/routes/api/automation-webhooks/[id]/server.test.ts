import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	authenticate: vi.fn(),
	deliver: vi.fn(),
	poll: vi.fn()
}));

vi.mock('$lib/server/automation/runtime', () => ({
	automationStore: { authenticateWebhook: h.authenticate, deliverWebhook: h.deliver }
}));
vi.mock('$lib/server/automation/scheduler-runtime', () => ({
	pollAutomationScheduler: h.poll
}));
vi.mock('$lib/server/maintenance', () => ({ assertMutationsAllowed: vi.fn() }));

import { POST } from './+server';

function event(body: unknown, token = 'token-a') {
	return {
		params: { id: 'automation-a' },
		request: new Request('http://localhost/api/automation-webhooks/automation-a', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-posterpilot-webhook-token': token
			},
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

function streamedEvent(body: string, token = 'token-a', chunkBytes = 16 * 1024) {
	const encoded = new TextEncoder().encode(body);
	let offset = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= encoded.byteLength) {
				controller.close();
				return;
			}
			const end = Math.min(encoded.byteLength, offset + chunkBytes);
			controller.enqueue(encoded.slice(offset, end));
			offset = end;
		}
	});
	return {
		params: { id: 'automation-a' },
		request: new Request('http://localhost/api/automation-webhooks/automation-a', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-posterpilot-webhook-token': token
			},
			body: stream,
			duplex: 'half'
		} as RequestInit & { duplex: 'half' })
	} as Parameters<typeof POST>[0];
}

describe('/api/automation-webhooks/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.authenticate.mockResolvedValue(undefined);
		h.deliver.mockResolvedValue({ id: 'occurrence-a' });
		h.poll.mockResolvedValue(undefined);
	});

	it('delivers a bounded external event and wakes the durable scheduler', async () => {
		const response = await POST(
			event({
				eventType: 'new_items',
				eventId: 'delivery-44',
				sourceItemIds: ['source-1'],
				occurredAt: '2026-07-11T10:00:00.000Z'
			})
		);
		expect(response.status).toBe(202);
		expect(h.authenticate).toHaveBeenCalledWith({
			scheduleId: 'automation-a',
			token: 'token-a'
		});
		expect(h.deliver).toHaveBeenCalledWith({
			scheduleId: 'automation-a',
			token: 'token-a',
			eventType: 'new_items',
			eventIdentity: 'delivery-44',
			sourceItemIds: ['source-1'],
			occurredAt: new Date('2026-07-11T10:00:00.000Z')
		});
		expect(h.poll).toHaveBeenCalledTimes(1);
		expect(await response.json()).toEqual({ ok: true, occurrenceId: 'occurrence-a' });
	});

	it('rejects unknown fields before reaching the store', async () => {
		const response = await POST(
			event({ eventType: 'new_items', eventId: 'delivery-44', sourceItemIds: [], apply: true })
		);
		expect(response.status).toBe(400);
		expect(h.deliver).not.toHaveBeenCalled();
	});

	it('returns a generic unauthorized response without revealing schedule state', async () => {
		let bodyAccessed = false;
		h.authenticate.mockRejectedValue(Object.assign(new Error(), { code: 'webhook_unauthorized' }));
		const request = {
			headers: new Headers({ 'x-posterpilot-webhook-token': 'wrong' }),
			get body(): never {
				bodyAccessed = true;
				throw new Error('body_must_not_be_consumed');
			}
		} as unknown as Request;
		const response = await POST({
			params: { id: 'automation-a' },
			request
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: { code: 'webhook_unauthorized' } });
		expect(bodyAccessed).toBe(false);
		expect(h.deliver).not.toHaveBeenCalled();
	});

	it('accepts a chunked JSON body at the 64 KiB limit', async () => {
		const payload = JSON.stringify({ eventType: 'sync_completed', eventId: 'delivery-64k' });
		const response = await POST(streamedEvent(payload + ' '.repeat(64 * 1024 - payload.length)));
		expect(response.status).toBe(202);
		expect(h.deliver).toHaveBeenCalledTimes(1);
	});

	it('rejects a chunked JSON body beyond 64 KiB without relying on Content-Length', async () => {
		const payload = JSON.stringify({ eventType: 'sync_completed', eventId: 'delivery-large' });
		const response = await POST(
			streamedEvent(payload + ' '.repeat(64 * 1024 + 1 - payload.length))
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: { code: 'invalid_request', field: 'body' }
		});
		expect(h.deliver).not.toHaveBeenCalled();
	});
});

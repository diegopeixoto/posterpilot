import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	list: vi.fn(),
	add: vi.fn(),
	test: vi.fn(),
	update: vi.fn(),
	enable: vi.fn(),
	disable: vi.fn(),
	activate: vi.fn(),
	disconnect: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({
	listManagedServers: h.list,
	addManagedServer: h.add,
	testManagedServer: h.test,
	updateManagedServer: h.update,
	enableManagedServer: h.enable,
	disableManagedServer: h.disable,
	setActiveServerInstance: h.activate,
	disconnectManagedServer: h.disconnect
}));

import { ServerInstanceError } from '$lib/server/server-instances/validation';
import { GET, POST as ADD } from './+server';
import { POST as TEST } from './test/+server';
import { PATCH } from './[id]/+server';
import { POST as ENABLE } from './[id]/enable/+server';
import { POST as DISABLE } from './[id]/disable/+server';
import { POST as ACTIVATE } from './[id]/activate/+server';
import { POST as DISCONNECT } from './[id]/disconnect/+server';

const SERVER = {
	id: 'server-1',
	name: 'Home Plex',
	type: 'plex',
	baseUrl: 'http://plex:32400',
	credentialSet: true,
	enabled: true,
	protected: false,
	connectionStatus: 'healthy',
	lastTestedAt: '2026-07-10T15:00:00.000Z',
	disconnectedAt: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-07-10T15:00:00.000Z'
};

function event(body: unknown = {}, id = 'server-1') {
	return {
		params: { id },
		request: { json: () => Promise.resolve(body) }
	} as never;
}

async function response(handler: unknown, value: unknown = event()) {
	return (handler as (event: unknown) => Response | Promise<Response>)(value);
}

describe('server-management API routes', () => {
	beforeEach(() => {
		for (const mock of Object.values(h)) mock.mockReset();
		h.list.mockResolvedValue({ servers: [SERVER], activeServerId: SERVER.id });
		h.add.mockResolvedValue(SERVER);
		h.test.mockResolvedValue({
			ok: true,
			status: 'healthy',
			testedAt: '2026-07-10T15:00:00.000Z',
			serverName: 'Living Room'
		});
		h.update.mockResolvedValue(SERVER);
		h.enable.mockResolvedValue(SERVER);
		h.disable.mockResolvedValue({ ...SERVER, enabled: false, connectionStatus: 'disabled' });
		h.activate.mockResolvedValue(SERVER);
		h.disconnect.mockImplementation(async (_id: string, confirmed: boolean) => {
			if (!confirmed) throw new ServerInstanceError('disconnect_confirmation_required');
			return { ...SERVER, enabled: false, credentialSet: false };
		});
	});

	it('lists only redacted summaries and the active id', async () => {
		const res = await response(GET, {});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ servers: [SERVER], activeServerId: 'server-1' });
		expect(body.servers[0]).not.toHaveProperty('credential');
	});

	it('adds a tested server with 201 without echoing its submitted secret', async () => {
		const res = await response(
			ADD,
			event({
				name: 'Home Plex',
				type: 'plex',
				baseUrl: 'http://plex:32400',
				credential: 'top-secret-token'
			})
		);
		expect(res.status).toBe(201);
		expect(h.add).toHaveBeenCalledWith({
			name: 'Home Plex',
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'top-secret-token',
			connectionSettings: undefined
		});
		expect(JSON.stringify(await res.json())).not.toContain('top-secret-token');
	});

	it('returns coherent structured validation, conflict, and connection statuses', async () => {
		h.add.mockRejectedValueOnce(new ServerInstanceError('invalid_base_url'));
		let res = await response(
			ADD,
			event({ name: 'A', type: 'plex', baseUrl: 'bad', credential: 'token' })
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: { code: 'invalid_base_url' } });

		h.add.mockRejectedValueOnce(new ServerInstanceError('duplicate_name'));
		res = await response(
			ADD,
			event({ name: 'A', type: 'plex', baseUrl: 'http://a', credential: 'token' })
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: { code: 'duplicate_name' } });

		h.add.mockRejectedValueOnce(new ServerInstanceError('connection_unauthorized'));
		res = await response(
			ADD,
			event({ name: 'A', type: 'plex', baseUrl: 'http://a', credential: 'token' })
		);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: { code: 'connection_unauthorized' } });

		h.add.mockRejectedValueOnce(new ServerInstanceError('connection_unreachable'));
		res = await response(
			ADD,
			event({ name: 'A', type: 'plex', baseUrl: 'http://a', credential: 'token' })
		);
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: { code: 'connection_unreachable' } });
	});

	it('returns connection-test failures as sanitized results rather than throwing', async () => {
		h.test.mockResolvedValue({
			ok: false,
			status: 'unreachable',
			testedAt: '2026-07-10T15:00:00.000Z',
			error: { code: 'connection_unreachable' }
		});
		const res = await response(
			TEST,
			event({ type: 'emby', baseUrl: 'http://emby:8096', credential: 'secret-key' })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			result: {
				ok: false,
				status: 'unreachable',
				testedAt: '2026-07-10T15:00:00.000Z',
				error: { code: 'connection_unreachable' }
			}
		});
	});

	it('rejects malformed JSON without returning parser details', async () => {
		const res = await response(ADD, {
			request: { json: () => Promise.reject(new Error('body contains secret-token')) }
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: { code: 'invalid_request' } });
	});

	it('forwards secret-preserving edits and rejects an empty update', async () => {
		let res = await response(PATCH, event({ name: 'Renamed', credential: '********' }));
		expect(res.status).toBe(200);
		expect(h.update).toHaveBeenCalledWith('server-1', {
			name: 'Renamed',
			type: undefined,
			baseUrl: undefined,
			credential: '********',
			connectionSettings: undefined
		});

		res = await response(PATCH, event({ unrelated: true }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: { code: 'invalid_request' } });
	});

	it('enables and disables only the addressed instance', async () => {
		let res = await response(ENABLE, event());
		expect(res.status).toBe(200);
		expect(h.enable).toHaveBeenCalledWith('server-1');

		res = await response(DISABLE, event());
		expect(res.status).toBe(200);
		expect(h.disable).toHaveBeenCalledWith('server-1');
	});

	it('activates only the addressed enabled instance', async () => {
		const res = await response(ACTIVATE, event());
		expect(res.status).toBe(200);
		expect(h.activate).toHaveBeenCalledWith('server-1');
		expect(await res.json()).toEqual({ server: SERVER });
	});

	it('requires explicit disconnect confirmation and never invokes purge/delete', async () => {
		let res = await response(DISCONNECT, event({}));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: { code: 'disconnect_confirmation_required' }
		});

		res = await response(DISCONNECT, event({ confirm: true }));
		expect(res.status).toBe(200);
		expect(h.disconnect).toHaveBeenLastCalledWith('server-1', true);
	});

	it('redacts unexpected exception messages behind a locale-neutral internal error', async () => {
		h.list.mockRejectedValue(new Error('database failed with top-secret-token'));
		const res = await response(GET, {});
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: { code: 'internal_error' } });
	});
});

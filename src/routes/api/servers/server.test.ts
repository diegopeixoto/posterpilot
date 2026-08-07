import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	list: vi.fn(),
	add: vi.fn(),
	test: vi.fn(),
	update: vi.fn(),
	enable: vi.fn(),
	disable: vi.fn(),
	activate: vi.fn(),
	disconnect: vi.fn(),
	resolveConfig: vi.fn(),
	checkpointGuard: vi.fn(),
	loadMigrationJournal: vi.fn(),
	withControlLock: vi.fn(),
	assertControlLockOwned: vi.fn()
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
vi.mock('$lib/server/config', () => ({ resolveConfig: h.resolveConfig }));
vi.mock('$lib/server/kometa/config-mutation-recovery', () => ({
	assertNoPendingKometaConfigMutationWhileOwned: h.checkpointGuard
}));
vi.mock('$lib/server/kometa/migration-store', () => ({
	loadActiveKometaMigrationJournal: h.loadMigrationJournal
}));
vi.mock('$lib/server/kometa/migration-control-lock', () => ({
	withKometaMigrationControlLock: h.withControlLock
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
		h.resolveConfig.mockResolvedValue({ kometaServerInstanceId: SERVER.id });
		h.assertControlLockOwned.mockResolvedValue('lease');
		h.checkpointGuard.mockImplementation(async (assertControlLockOwned: () => Promise<unknown>) =>
			assertControlLockOwned()
		);
		h.loadMigrationJournal.mockResolvedValue(null);
		h.withControlLock.mockImplementation(
			async (operation: (assertOwned: () => Promise<unknown>) => Promise<unknown>) =>
				operation(h.assertControlLockOwned)
		);
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
		expect(h.update).toHaveBeenCalledWith(
			'server-1',
			{
				name: 'Renamed',
				type: undefined,
				baseUrl: undefined,
				credential: '********',
				connectionSettings: undefined
			},
			'lease'
		);

		res = await response(PATCH, event({ unrelated: true }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: { code: 'invalid_request' } });
	});

	it('blocks every bound-server mutation that could invalidate config recovery', async () => {
		const attempts = [
			[PATCH, event({ baseUrl: 'http://plex-new:32400' }), h.update],
			[DISABLE, event(), h.disable],
			[DISCONNECT, event({ confirm: true }), h.disconnect]
		] as const;

		for (const [handler, value, mutation] of attempts) {
			h.checkpointGuard.mockRejectedValueOnce(new Error('checkpoint corrupt'));
			const res = await response(handler, value);
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: { code: 'kometa_config_recovery_required' }
			});
			expect(mutation).not.toHaveBeenCalled();
		}
	});

	it('renews the durable control lease immediately before each bound-server mutation', async () => {
		const attempts = [
			[PATCH, event({ baseUrl: 'http://plex-new:32400' }), h.update],
			[DISABLE, event(), h.disable],
			[DISCONNECT, event({ confirm: true }), h.disconnect]
		] as const;

		for (const [handler, value, mutation] of attempts) {
			await response(handler, value);
			const finalRenewal = h.assertControlLockOwned.mock.invocationCallOrder.at(-1);
			const write = mutation.mock.invocationCallOrder.at(-1);
			expect(finalRenewal).toBeDefined();
			expect(write).toBeDefined();
			expect(finalRenewal!).toBeLessThan(write!);
			expect(mutation.mock.calls.at(-1)?.at(-1)).toBe('lease');
		}
	});

	it('blocks binding-invalidating mutations while a Kometa migration is incomplete', async () => {
		h.loadMigrationJournal.mockResolvedValue({
			status: 'writing_splits',
			payload: { serverInstanceId: SERVER.id }
		});
		const attempts = [
			[PATCH, event({ credential: 'rotated-secret' }), h.update],
			[DISABLE, event(), h.disable],
			[DISCONNECT, event({ confirm: true }), h.disconnect]
		] as const;

		for (const [handler, value, mutation] of attempts) {
			const res = await response(handler, value);
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: { code: 'kometa_migration_config_locked' }
			});
			expect(mutation).not.toHaveBeenCalled();
		}
	});

	it('still blocks the frozen journal server after the configured binding drifts elsewhere', async () => {
		h.resolveConfig.mockResolvedValue({ kometaServerInstanceId: 'server-2' });
		h.loadMigrationJournal.mockResolvedValue({
			status: 'writing_splits',
			payload: { serverInstanceId: SERVER.id }
		});
		const attempts = [
			[PATCH, event({ credential: 'rotated-secret' }), h.update],
			[DISABLE, event(), h.disable],
			[DISCONNECT, event({ confirm: true }), h.disconnect]
		] as const;

		for (const [handler, value, mutation] of attempts) {
			const res = await response(handler, value);
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({ error: { code: 'kometa_migration_config_locked' } });
			expect(h.checkpointGuard).not.toHaveBeenCalled();
			expect(mutation).not.toHaveBeenCalled();
		}
	});

	it('fails closed when the bound server migration journal is unreadable', async () => {
		h.loadMigrationJournal.mockRejectedValue(new Error('journal authentication failed'));

		const res = await response(DISABLE, event());

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: { code: 'kometa_migration_config_locked' } });
		expect(h.disable).not.toHaveBeenCalled();
	});

	it('does not apply the checkpoint guard to another server or a name-only edit', async () => {
		h.resolveConfig.mockResolvedValue({ kometaServerInstanceId: 'server-2' });
		let res = await response(PATCH, event({ baseUrl: 'http://plex-new:32400' }));
		expect(res.status).toBe(200);
		expect(h.checkpointGuard).not.toHaveBeenCalled();
		expect(h.assertControlLockOwned).toHaveBeenCalledOnce();

		h.withControlLock.mockClear();
		h.assertControlLockOwned.mockClear();
		res = await response(PATCH, event({ name: 'Renamed' }));
		expect(res.status).toBe(200);
		expect(h.withControlLock).not.toHaveBeenCalled();
		expect(h.assertControlLockOwned).not.toHaveBeenCalled();
	});

	it('enables and disables only the addressed instance', async () => {
		let res = await response(ENABLE, event());
		expect(res.status).toBe(200);
		expect(h.enable).toHaveBeenCalledWith('server-1');

		res = await response(DISABLE, event());
		expect(res.status).toBe(200);
		expect(h.disable).toHaveBeenCalledWith('server-1', 'lease');
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
		expect(h.disconnect).toHaveBeenLastCalledWith('server-1', true, 'lease');
	});

	it('redacts unexpected exception messages behind a locale-neutral internal error', async () => {
		h.list.mockRejectedValue(new Error('database failed with top-secret-token'));
		const res = await response(GET, {});
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: { code: 'internal_error' } });
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionResult } from '$lib/server/media-server/types';
import type { ServerInstanceConnection, ServerInstanceSummary } from './store';
import { createServerManagementService } from './management';

const NOW = new Date('2026-07-10T15:00:00.000Z');

function summary(overrides: Partial<ServerInstanceSummary> = {}): ServerInstanceSummary {
	return {
		id: 'server-1',
		name: 'Home Plex',
		type: 'plex',
		baseUrl: 'http://plex:32400',
		credentialSet: true,
		enabled: true,
		protected: false,
		connectionStatus: 'healthy',
		lastTestedAt: null,
		disconnectedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides
	};
}

function connection(overrides: Partial<ServerInstanceConnection> = {}): ServerInstanceConnection {
	return {
		...summary(),
		credential: 'stored-token',
		connectionSettings: { plexClientId: 'client-1' },
		capabilities: null,
		...overrides
	};
}

function fixture(providerResult: ConnectionResult = { ok: true }) {
	const current = connection();
	const store = {
		list: vi.fn(async () => [summary()]),
		getActive: vi.fn(async () => summary()),
		create: vi.fn(async () => summary()),
		update: vi.fn(async () => summary()),
		getConnection: vi.fn(async () => current),
		disconnect: vi.fn(async () =>
			summary({ enabled: false, credentialSet: false, disconnectedAt: NOW })
		)
	};
	const testConnection = vi.fn(async () => providerResult);
	const providerFactory = vi.fn(() => ({
		testConnection,
		capabilities: {
			posterWrite: 'supported' as const,
			backgroundWrite: 'supported' as const,
			seasonWrite: 'supported' as const,
			episodeWrite: 'supported' as const,
			fieldLock: 'supported' as const,
			currentImageRetrieval: 'supported' as const,
			artworkDelete: 'unsupported' as const,
			evidence: 'provider_contract' as const,
			limitations: ['artwork_delete_unavailable']
		}
	}));
	const service = createServerManagementService(store, {
		clock: () => new Date(NOW),
		providerFactory
	});
	return { current, store, testConnection, providerFactory, service };
}

describe('server management domain service', () => {
	beforeEach(() => vi.clearAllMocks());

	it('lists redacted summaries with the persisted active id', async () => {
		const { service } = fixture();
		const result = await service.list();
		expect(result).toEqual({ servers: [summary()], activeServerId: 'server-1' });
		expect(result.servers[0]).not.toHaveProperty('credential');
	});

	it('tests a new connection before creating it and records a healthy initial status', async () => {
		const { service, store, providerFactory } = fixture({
			ok: true,
			serverName: 'Living Room',
			version: '1.2.3'
		});

		const result = await service.add({
			name: 'Living Room',
			type: 'plex',
			baseUrl: 'http://PLEX:32400/',
			credential: 'new-token'
		});

		expect(providerFactory).toHaveBeenCalledWith({
			serverId: null,
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'new-token',
			connectionSettings: null
		});
		expect(store.create).toHaveBeenCalledWith(
			expect.objectContaining({
				credential: 'new-token',
				connectionStatus: 'healthy',
				lastTestedAt: NOW
			})
		);
		expect(result).not.toHaveProperty('credential');
	});

	it('does not persist a new instance when the credential is rejected', async () => {
		const { service, store } = fixture({
			ok: false,
			unauthorized: true,
			error: 'Unauthorized: token new-token was rejected'
		});

		await expect(
			service.add({
				name: 'Rejected',
				type: 'plex',
				baseUrl: 'http://plex:32400',
				credential: 'new-token'
			})
		).rejects.toMatchObject({
			code: 'connection_unauthorized',
			message: 'connection_unauthorized'
		});
		expect(store.create).not.toHaveBeenCalled();
	});

	it('returns a locale-neutral sanitized test result and records it against a saved instance', async () => {
		const { service, store } = fixture({
			ok: false,
			error: 'network request included stored-token and failed'
		});

		const result = await service.test({ id: 'server-1' });
		expect(result).toEqual({
			ok: false,
			status: 'unreachable',
			serverId: 'server-1',
			testedAt: NOW.toISOString(),
			error: { code: 'connection_unreachable' }
		});
		expect(JSON.stringify(result)).not.toContain('stored-token');
		expect(store.update).toHaveBeenCalledWith('server-1', {
			connectionStatus: 'unreachable',
			lastTestedAt: NOW
		});
	});

	it('preserves the stored secret and skips retesting for a masked name-only update', async () => {
		const { service, store, providerFactory } = fixture();
		await service.update('server-1', { name: 'Renamed Plex', credential: '********' });

		expect(providerFactory).not.toHaveBeenCalled();
		expect(store.update).toHaveBeenCalledWith('server-1', { name: 'Renamed Plex' });
	});

	it('retains working details when a replacement credential fails testing', async () => {
		const { service, store, providerFactory } = fixture({
			ok: false,
			unauthorized: true,
			error: 'bad replacement-token'
		});

		await expect(
			service.update('server-1', { credential: 'replacement-token' })
		).rejects.toMatchObject({ code: 'connection_unauthorized' });
		expect(providerFactory).toHaveBeenCalledWith(
			expect.objectContaining({ credential: 'replacement-token' })
		);
		expect(store.update).toHaveBeenCalledTimes(1);
		expect(store.update).toHaveBeenCalledWith('server-1', {
			connectionStatus: 'unauthorized',
			lastTestedAt: NOW
		});
		expect(JSON.stringify(store.update.mock.calls)).not.toContain('replacement-token');
	});

	it('persists replacement details only after a successful test', async () => {
		const { service, store } = fixture({ ok: true, serverName: 'Updated' });
		await service.update('server-1', {
			baseUrl: 'http://new-plex:32400/',
			credential: 'replacement-token'
		});

		expect(store.update).toHaveBeenCalledWith('server-1', {
			baseUrl: 'http://new-plex:32400',
			credential: 'replacement-token',
			connectionStatus: 'healthy',
			lastTestedAt: NOW,
			capabilities: expect.objectContaining({
				posterWrite: 'supported',
				currentImageRetrieval: 'supported',
				artworkDelete: 'unsupported'
			})
		});
	});

	it('tests before enabling and leaves the instance disabled on failure', async () => {
		const { service, store } = fixture({ ok: false, error: 'offline' });
		await expect(service.enable('server-1')).rejects.toMatchObject({
			code: 'connection_unreachable'
		});
		expect(store.update).toHaveBeenCalledTimes(1);
		expect(store.update).toHaveBeenCalledWith('server-1', {
			connectionStatus: 'unreachable',
			lastTestedAt: NOW
		});
	});

	it('requires confirmation before delegating a non-destructive disconnect', async () => {
		const { service, store } = fixture();
		await expect(service.disconnect('server-1', false)).rejects.toMatchObject({
			code: 'disconnect_confirmation_required'
		});
		expect(store.disconnect).not.toHaveBeenCalled();

		await service.disconnect('server-1', true);
		expect(store.disconnect).toHaveBeenCalledWith('server-1');
	});

	it('refuses to update or re-enable disconnected history', async () => {
		const { service, store } = fixture();
		store.getConnection.mockResolvedValue(
			connection({ enabled: false, credential: null, disconnectedAt: NOW })
		);

		await expect(service.update('server-1', { name: 'Changed' })).rejects.toMatchObject({
			code: 'server_instance_disconnected'
		});
		await expect(service.enable('server-1')).rejects.toMatchObject({
			code: 'server_instance_disconnected'
		});
		expect(store.update).not.toHaveBeenCalled();
	});
});

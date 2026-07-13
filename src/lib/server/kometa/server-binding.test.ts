import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	getServerInstance: vi.fn(),
	getServerInstanceConnection: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({
	getServerInstance: h.getServerInstance,
	getServerInstanceConnection: h.getServerInstanceConnection
}));

import { resolveKometaServerBinding } from './server-binding';

describe('resolveKometaServerBinding', () => {
	beforeEach(() => vi.clearAllMocks());

	it('fails closed when no explicit instance exists', async () => {
		await expect(resolveKometaServerBinding(null)).resolves.toEqual({
			status: 'missing',
			binding: null
		});
		expect(h.getServerInstance).not.toHaveBeenCalled();
	});

	it('rejects a non-Plex instance without looking for substitute credentials', async () => {
		h.getServerInstance.mockResolvedValue({
			id: 'jellyfin-a',
			type: 'jellyfin',
			enabled: true,
			disconnectedAt: null
		});
		await expect(resolveKometaServerBinding('jellyfin-a')).resolves.toEqual({
			status: 'incompatible',
			binding: null
		});
		expect(h.getServerInstanceConnection).not.toHaveBeenCalled();
	});

	it('returns only the credentials of the exact configured Plex instance', async () => {
		h.getServerInstance.mockResolvedValue({
			id: 'plex-b',
			type: 'plex',
			enabled: true,
			disconnectedAt: null
		});
		h.getServerInstanceConnection.mockResolvedValue({
			id: 'plex-b',
			name: 'Plex B',
			baseUrl: 'https://plex-b.example',
			credential: 'secret-b'
		});

		await expect(resolveKometaServerBinding('plex-b')).resolves.toEqual({
			status: 'ready',
			binding: {
				id: 'plex-b',
				name: 'Plex B',
				plexUrl: 'https://plex-b.example',
				plexToken: 'secret-b'
			}
		});
		expect(h.getServerInstanceConnection).toHaveBeenCalledWith('plex-b', {
			requireEnabled: true
		});
	});
});

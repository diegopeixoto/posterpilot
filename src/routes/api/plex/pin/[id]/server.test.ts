import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class ControlError extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	}
	class AuthError extends Error {}
	return {
		ControlError,
		AuthError,
		ensureClientId: vi.fn(),
		pollPin: vi.fn(),
		saveSettings: vi.fn(),
		materialize: vi.fn(),
		logEvent: vi.fn(),
		assertOwned: vi.fn(),
		withControl: vi.fn()
	};
});

vi.mock('$lib/server/config', () => ({
	ensurePlexClientId: h.ensureClientId,
	saveSettings: h.saveSettings
}));
vi.mock('$lib/server/media-server/plex-auth', () => ({
	PlexAuthError: h.AuthError,
	pollPin: h.pollPin
}));
vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('$lib/server/server-instances', () => ({
	materializeLegacyServerInstance: h.materialize
}));
vi.mock('$lib/server/server-instances/legacy-mutation', () => ({
	LegacyServerMutationControlError: h.ControlError,
	withLegacyServerMutationControl: h.withControl
}));

import { GET } from './+server';

beforeEach(() => {
	vi.clearAllMocks();
	h.ensureClientId.mockResolvedValue('client-id');
	h.pollPin.mockResolvedValue('plex-token');
	h.assertOwned.mockResolvedValue('materialize-lease');
	h.withControl.mockImplementation(
		async (
			operation: (control: {
				assertControlLockOwned: typeof h.assertOwned;
				controlLease: string;
			}) => Promise<unknown>
		) => operation({ assertControlLockOwned: h.assertOwned, controlLease: 'settings-lease' })
	);
});

describe('GET /api/plex/pin/[id]', () => {
	it('persists and materializes the legacy binding with renewed transaction fences', async () => {
		const response = await GET({ params: { id: '42' } } as Parameters<typeof GET>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ authorized: true });
		expect(h.saveSettings).toHaveBeenCalledWith(
			{ plexToken: 'plex-token', serverType: 'plex' },
			'settings-lease'
		);
		expect(h.assertOwned).toHaveBeenCalledTimes(1);
		expect(h.materialize).toHaveBeenCalledWith('materialize-lease');
	});

	it('returns a retryable conflict without writing when the guard blocks the mutation', async () => {
		h.withControl.mockRejectedValue(new h.ControlError('kometa_migration_config_locked'));

		const response = await GET({ params: { id: '42' } } as Parameters<typeof GET>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_migration_config_locked' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.materialize).not.toHaveBeenCalled();
	});
});

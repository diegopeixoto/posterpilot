import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class ControlError extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	}
	class LoginError extends Error {
		constructor(
			message: string,
			readonly status: number
		) {
			super(message);
		}
	}
	return {
		ControlError,
		LoginError,
		login: vi.fn(),
		saveSettings: vi.fn(),
		materialize: vi.fn(),
		logEvent: vi.fn(),
		assertOwned: vi.fn(),
		withControl: vi.fn()
	};
});

vi.mock('$lib/server/config', () => ({ saveSettings: h.saveSettings }));
vi.mock('$lib/server/media-server/emby', () => ({
	MediaServerLoginError: h.LoginError,
	loginByName: h.login
}));
vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('$lib/server/server-instances', () => ({
	materializeLegacyServerInstance: h.materialize
}));
vi.mock('$lib/server/server-instances/legacy-mutation', () => ({
	LegacyServerMutationControlError: h.ControlError,
	withLegacyServerMutationControl: h.withControl
}));

import { POST } from './+server';

function request(flavor: 'jellyfin' | 'emby' = 'jellyfin') {
	return new Request('http://localhost/api/media-server/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			flavor,
			baseUrl: 'http://media.invalid',
			username: 'admin',
			password: 'secret'
		})
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.login.mockResolvedValue({ accessToken: 'access-token', userName: 'Admin' });
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

describe('POST /api/media-server/login', () => {
	it.each([
		[
			'jellyfin',
			{
				serverType: 'jellyfin',
				jellyfinUrl: 'http://media.invalid',
				jellyfinApiKey: 'access-token'
			}
		],
		['emby', { serverType: 'emby', embyUrl: 'http://media.invalid', embyApiKey: 'access-token' }]
	] as const)(
		'fences the %s settings and legacy materialization transactions',
		async (flavor, settings) => {
			const response = await POST({ request: request(flavor) } as Parameters<typeof POST>[0]);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true, userName: 'Admin' });
			expect(h.saveSettings).toHaveBeenCalledWith(settings, 'settings-lease');
			expect(h.assertOwned).toHaveBeenCalledTimes(1);
			expect(h.materialize).toHaveBeenCalledWith('materialize-lease');
		}
	);

	it('returns a conflict and leaves credentials untouched when the guard blocks the mutation', async () => {
		h.withControl.mockRejectedValue(new h.ControlError('kometa_config_recovery_required'));

		const response = await POST({ request: request() } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_config_recovery_required' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.materialize).not.toHaveBeenCalled();
	});
});

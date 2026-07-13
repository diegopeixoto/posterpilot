import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	saveSettings: vi.fn(),
	setArtworkRankingSettings: vi.fn(),
	setIncludedSectionsForServer: vi.fn(),
	logEvent: vi.fn(),
	materializeLegacy: vi.fn(),
	getActiveServerInstance: vi.fn(),
	resolveKometaServerBinding: vi.fn()
}));

vi.mock('$lib/server/config', () => ({
	saveSettings: h.saveSettings,
	setArtworkRankingSettings: h.setArtworkRankingSettings,
	setIncludedSectionsForServer: h.setIncludedSectionsForServer
}));
vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('$lib/server/server-instances', () => ({
	materializeLegacyServerInstance: h.materializeLegacy,
	getActiveServerInstance: h.getActiveServerInstance
}));
vi.mock('$lib/server/kometa/server-binding', () => ({
	resolveKometaServerBinding: h.resolveKometaServerBinding
}));

import { POST } from './+server';

const validRanking = {
	providerPriority: ['tmdb', 'mediux', 'theposterdb', 'fanarttv'],
	weights: {
		providerWeights: { mediux: 1, theposterdb: 0.8, fanarttv: 0.7, tmdb: 0.6 },
		resolutionWeight: 0.5,
		aspectWeight: 0.3
	}
};

function request(body: unknown) {
	return new Request('http://localhost/api/settings', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

describe('POST /api/settings artwork ranking', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getActiveServerInstance.mockResolvedValue({ id: 'server-a' });
		h.resolveKometaServerBinding.mockResolvedValue({
			status: 'ready',
			binding: { id: 'server-a', name: 'Plex A' }
		});
	});

	it('rejects an incomplete or out-of-range definition before any write', async () => {
		const response = await POST({
			request: request({
				defaultApplyMethod: 'plex',
				ranking: {
					...validRanking,
					weights: { ...validRanking.weights, aspectWeight: 99 }
				}
			})
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: 'invalid_artwork_ranking' } });
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.setArtworkRankingSettings).not.toHaveBeenCalled();
	});

	it('persists library selection only under the active server scope', async () => {
		const response = await POST({
			request: request({ includedSections: ['movies', 'shows'] })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(h.setIncludedSectionsForServer).toHaveBeenCalledWith('server-a', ['movies', 'shows']);
		expect(h.saveSettings).toHaveBeenCalledWith({});
		expect(h.logEvent).toHaveBeenCalledWith(
			'info',
			'settings',
			'Library selection changed (2 libraries)',
			{ count: 2, serverInstanceId: 'server-a' }
		);
	});

	it('rejects a non-Plex Kometa binding before saving anything', async () => {
		h.resolveKometaServerBinding.mockResolvedValue({ status: 'incompatible', binding: null });
		const response = await POST({
			request: request({ kometaServerInstanceId: 'jellyfin-b' })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_server_binding_incompatible' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it('persists the regular configuration and complete ranking together', async () => {
		const response = await POST({
			request: request({ defaultApplyMethod: 'plex', ranking: validRanking })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(h.saveSettings).toHaveBeenCalledWith({ defaultApplyMethod: 'plex' });
		expect(h.setArtworkRankingSettings).toHaveBeenCalledWith(validRanking);
		expect(h.logEvent).toHaveBeenCalledWith('info', 'settings', 'Settings updated', {
			keys: ['defaultApplyMethod', 'artworkRanking']
		});
	});
});

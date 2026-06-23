import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaItem } from '$lib/server/db/schema';
import type { AppConfig } from '$lib/server/config';

// Hoisted mocks so we can control behavior per test.
const h = vi.hoisted(() => ({
	applyPosterUrl: vi.fn<(...a: unknown[]) => Promise<void>>(),
	applyBackgroundUrl: vi.fn<(...a: unknown[]) => Promise<void>>(),
	writeKometaYaml: vi.fn<(...a: unknown[]) => Promise<void>>(),
	inserts: [] as Record<string, unknown>[]
}));

// db: applyToItem only ever calls db.insert(appliedPosters).values({...}).
vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({
			values: (v: Record<string, unknown>) => {
				h.inserts.push(v);
				return Promise.resolve();
			}
		})
	}
}));

// The active media-server provider: resolveActiveServer returns a fake MediaServer
// whose poster/background applies are spied. When the config lacks the active
// provider's credentials it reports the missing keys (mirroring the real factory).
vi.mock('$lib/server/media-server', () => ({
	serverTypeLabel: (t: string) => t,
	resolveActiveServer: (cfg: Record<string, unknown>) => {
		if (!cfg.plexUrl || !cfg.plexToken) {
			return { server: null, missing: ['plexUrl', 'plexToken'].filter((k) => !cfg[k]) };
		}
		return {
			server: {
				type: 'plex',
				applyPosterUrl: h.applyPosterUrl,
				applyBackgroundUrl: h.applyBackgroundUrl
			},
			missing: []
		};
	}
}));
vi.mock('$lib/server/kometa/yaml', () => ({ writeKometaYaml: h.writeKometaYaml }));
// applyToItem now logs per-method outcomes; stub the event log so it doesn't touch
// the db (and so it isn't counted among the appliedPosters inserts under test).
vi.mock('$lib/server/events', () => ({ logEvent: vi.fn(() => Promise.resolve()) }));

import { applyToItem } from './service';

const item = {
	id: 1,
	ratingKey: '1001',
	title: 'Fight Club',
	tmdbId: '550'
} as unknown as MediaItem;

const config = {
	serverType: 'plex',
	plexUrl: 'http://plex:32400',
	plexToken: 'tok',
	kometaAssetsDir: '/kometa'
} as unknown as AppConfig;

describe('applyToItem', () => {
	beforeEach(() => {
		h.applyPosterUrl.mockReset().mockResolvedValue(undefined);
		h.applyBackgroundUrl.mockReset().mockResolvedValue(undefined);
		h.writeKometaYaml.mockReset().mockResolvedValue(undefined);
		h.inserts.length = 0;
	});

	it('applies via the active server only and records success', async () => {
		const outcomes = await applyToItem(item, { posterUrl: 'u', method: 'plex', config });
		expect(outcomes).toEqual([{ method: 'plex', status: 'success' }]);
		expect(h.applyPosterUrl).toHaveBeenCalledWith('1001', 'u');
		expect(h.writeKometaYaml).not.toHaveBeenCalled();
		expect(h.inserts).toHaveLength(1);
		expect(h.inserts[0]).toMatchObject({ method: 'plex', status: 'success' });
	});

	it('applies a background through the provider when supplied', async () => {
		await applyToItem(item, { posterUrl: 'u', backgroundUrl: 'bg', method: 'plex', config });
		expect(h.applyPosterUrl).toHaveBeenCalledWith('1001', 'u');
		expect(h.applyBackgroundUrl).toHaveBeenCalledWith('1001', 'bg');
	});

	it('applies via Kometa only and records success', async () => {
		const outcomes = await applyToItem(item, {
			posterUrl: 'u',
			backgroundUrl: 'b',
			method: 'kometa',
			config
		});
		expect(outcomes).toEqual([{ method: 'kometa', status: 'success' }]);
		expect(h.writeKometaYaml).toHaveBeenCalledWith('/kometa', [
			{ tmdbId: '550', title: 'Fight Club', posterUrl: 'u', backgroundUrl: 'b' }
		]);
		expect(h.applyPosterUrl).not.toHaveBeenCalled();
		expect(h.inserts).toHaveLength(1);
	});

	it('applies both methods, recording each independently', async () => {
		const outcomes = await applyToItem(item, { posterUrl: 'u', method: 'both', config });
		expect(outcomes.map((o) => o.method)).toEqual(['plex', 'kometa']);
		expect(outcomes.every((o) => o.status === 'success')).toBe(true);
		expect(h.inserts).toHaveLength(2);
	});

	it('records a partial failure: server fails, Kometa succeeds', async () => {
		h.applyPosterUrl.mockRejectedValueOnce(new Error('plex 500'));
		const outcomes = await applyToItem(item, { posterUrl: 'u', method: 'both', config });
		expect(outcomes[0]).toEqual({ method: 'plex', status: 'failed', error: 'plex 500' });
		expect(outcomes[1]).toEqual({ method: 'kometa', status: 'success' });
		expect(h.inserts).toHaveLength(2);
		expect(h.inserts[0]).toMatchObject({ method: 'plex', status: 'failed', error: 'plex 500' });
		expect(h.inserts[1]).toMatchObject({ method: 'kometa', status: 'success' });
	});

	it('records a server failure when the active provider is unconfigured', async () => {
		const outcomes = await applyToItem(item, {
			posterUrl: 'u',
			method: 'plex',
			config: { serverType: 'plex', kometaAssetsDir: '/kometa' } as unknown as AppConfig
		});
		expect(outcomes[0].status).toBe('failed');
		expect(outcomes[0].error).toContain('not configured');
		expect(h.applyPosterUrl).not.toHaveBeenCalled();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaItem } from '$lib/server/db/schema';
import type { AppConfig } from '$lib/server/config';

// Hoisted mocks so we can control behavior per test.
const h = vi.hoisted(() => ({
	uploadPosterFromUrl: vi.fn<(...a: unknown[]) => Promise<void>>(),
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
vi.mock('$lib/server/plex/client', () => ({ uploadPosterFromUrl: h.uploadPosterFromUrl }));
vi.mock('$lib/server/kometa/yaml', () => ({ writeKometaYaml: h.writeKometaYaml }));
vi.mock('$lib/server/config', () => ({
	requireConfig: (cfg: Record<string, unknown>, keys: string[]) => {
		const missing = keys.filter((k) => !cfg[k]);
		if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
	}
}));

import { applyToItem } from './service';

const item = {
	id: 1,
	ratingKey: '1001',
	title: 'Fight Club',
	tmdbId: '550'
} as unknown as MediaItem;

const config = {
	plexUrl: 'http://plex:32400',
	plexToken: 'tok',
	kometaAssetsDir: '/kometa'
} as unknown as AppConfig;

describe('applyToItem', () => {
	beforeEach(() => {
		h.uploadPosterFromUrl.mockReset().mockResolvedValue(undefined);
		h.writeKometaYaml.mockReset().mockResolvedValue(undefined);
		h.inserts.length = 0;
	});

	it('applies via Plex only and records success', async () => {
		const outcomes = await applyToItem(item, { posterUrl: 'u', method: 'plex', config });
		expect(outcomes).toEqual([{ method: 'plex', status: 'success' }]);
		expect(h.uploadPosterFromUrl).toHaveBeenCalledWith('http://plex:32400', 'tok', '1001', 'u');
		expect(h.writeKometaYaml).not.toHaveBeenCalled();
		expect(h.inserts).toHaveLength(1);
		expect(h.inserts[0]).toMatchObject({ method: 'plex', status: 'success' });
	});

	it('applies via Kometa only and records success', async () => {
		const outcomes = await applyToItem(item, { posterUrl: 'u', backgroundUrl: 'b', method: 'kometa', config });
		expect(outcomes).toEqual([{ method: 'kometa', status: 'success' }]);
		expect(h.writeKometaYaml).toHaveBeenCalledWith('/kometa', [
			{ tmdbId: '550', title: 'Fight Club', posterUrl: 'u', backgroundUrl: 'b' }
		]);
		expect(h.uploadPosterFromUrl).not.toHaveBeenCalled();
		expect(h.inserts).toHaveLength(1);
	});

	it('applies both methods, recording each independently', async () => {
		const outcomes = await applyToItem(item, { posterUrl: 'u', method: 'both', config });
		expect(outcomes.map((o) => o.method)).toEqual(['plex', 'kometa']);
		expect(outcomes.every((o) => o.status === 'success')).toBe(true);
		expect(h.inserts).toHaveLength(2);
	});

	it('records a partial failure: Plex fails, Kometa succeeds', async () => {
		h.uploadPosterFromUrl.mockRejectedValueOnce(new Error('plex 500'));
		const outcomes = await applyToItem(item, { posterUrl: 'u', method: 'both', config });
		expect(outcomes[0]).toEqual({ method: 'plex', status: 'failed', error: 'plex 500' });
		expect(outcomes[1]).toEqual({ method: 'kometa', status: 'success' });
		expect(h.inserts).toHaveLength(2);
		expect(h.inserts[0]).toMatchObject({ method: 'plex', status: 'failed', error: 'plex 500' });
		expect(h.inserts[1]).toMatchObject({ method: 'kometa', status: 'success' });
	});

	it('records a Plex failure when required config is missing', async () => {
		const outcomes = await applyToItem(item, {
			posterUrl: 'u',
			method: 'plex',
			config: { kometaAssetsDir: '/kometa' } as unknown as AppConfig
		});
		expect(outcomes[0].status).toBe('failed');
		expect(outcomes[0].error).toContain('Missing required configuration');
		expect(h.uploadPosterFromUrl).not.toHaveBeenCalled();
	});
});

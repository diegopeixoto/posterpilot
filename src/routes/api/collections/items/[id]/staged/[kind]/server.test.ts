import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	getActiveServerInstance: vi.fn(),
	getMediaItem: vi.fn(),
	getStagedRootArtworkSource: vi.fn(),
	resolveConfig: vi.fn(),
	getOrFetchThumb: vi.fn()
}));

vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.getActiveServerInstance
}));
vi.mock('$lib/server/queries', () => ({ getMediaItem: h.getMediaItem }));
vi.mock('$lib/server/collections/staged-artwork-source', () => ({
	getStagedRootArtworkSource: h.getStagedRootArtworkSource
}));
vi.mock('$lib/server/config', () => ({ resolveConfig: h.resolveConfig }));
vi.mock('$lib/server/posters/thumb-cache', () => ({ getOrFetchThumb: h.getOrFetchThumb }));

import { GET } from './+server';

const original = 'https://image.tmdb.org/t/p/original/poster.jpg';
const preview = 'https://image.tmdb.org/t/p/w500/poster.jpg';

function request() {
	return { params: { id: '42', kind: 'poster' } } as Parameters<typeof GET>[0];
}

describe('GET /api/collections/items/[id]/staged/[kind]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getActiveServerInstance.mockResolvedValue({ id: 'server-a' });
		h.getMediaItem.mockResolvedValue({
			id: 42,
			serverInstanceId: 'server-a',
			selectedPosterUrl: original,
			selectedBackgroundUrl: null
		});
		h.getStagedRootArtworkSource.mockResolvedValue(preview);
		h.resolveConfig.mockResolvedValue({ thumbCacheTtlDays: 7, thumbCacheMaxMb: 5 });
		h.getOrFetchThumb.mockResolvedValue({
			bytes: new Uint8Array([1, 2, 3]),
			contentType: 'image/jpeg'
		});
	});

	it('sends the proven optimized preview to the thumbnail cache', async () => {
		const response = await GET(request());

		expect(response.status).toBe(200);
		expect(h.getStagedRootArtworkSource).toHaveBeenCalledWith(
			expect.objectContaining({ id: 42, selectedPosterUrl: original }),
			'poster'
		);
		expect(h.getOrFetchThumb).toHaveBeenCalledWith(preview, expect.any(Object));
		expect(h.getOrFetchThumb).not.toHaveBeenCalledWith(original, expect.any(Object));
	});

	it('falls back to the safe selected URL when candidate preview metadata is unsafe', async () => {
		h.getStagedRootArtworkSource.mockResolvedValue('https://attacker.invalid/poster.jpg');

		const response = await GET(request());

		expect(response.status).toBe(200);
		expect(h.getOrFetchThumb).toHaveBeenCalledWith(original, expect.any(Object));
	});
});

import { describe, expect, it } from 'vitest';
import { resizedPosterUrl, versionedArtworkUrl, GRID_THUMB_WIDTH } from './poster-thumb';

describe('media-server/poster-thumb · resizedPosterUrl', () => {
	it('appends fillWidth for Emby/Jellyfin image URLs', () => {
		const url = 'http://jelly:8096/Items/i1/Images/Primary?tag=abc&api_key=key1';
		expect(resizedPosterUrl('jellyfin', url)).toBe(
			`${url}&fillWidth=${GRID_THUMB_WIDTH}&quality=90`
		);
		expect(resizedPosterUrl('emby', url, 200)).toBe(`${url}&fillWidth=200&quality=90`);
	});

	it('uses ? when the original has no query string', () => {
		expect(resizedPosterUrl('emby', 'http://x/img')).toBe(
			`http://x/img?fillWidth=${GRID_THUMB_WIDTH}&quality=90`
		);
	});

	it('returns Plex URLs unchanged (cached full-size)', () => {
		const url = 'http://plex:32400/library/metadata/1/thumb/123?X-Plex-Token=tok';
		expect(resizedPosterUrl('plex', url)).toBe(url);
	});

	it('passes an empty URL through unchanged', () => {
		expect(resizedPosterUrl('emby', '')).toBe('');
	});
});

describe('versionedArtworkUrl', () => {
	it('adds or replaces a bounded cache version while preserving credentials', () => {
		expect(versionedArtworkUrl('https://server/image?token=secret', 4)).toBe(
			'https://server/image?token=secret&posterpilot_v=4'
		);
		expect(versionedArtworkUrl('https://server/image?posterpilot_v=2', 7)).toBe(
			'https://server/image?posterpilot_v=7'
		);
		expect(versionedArtworkUrl('https://server/image', -1)).toBe(
			'https://server/image?posterpilot_v=0'
		);
	});
});

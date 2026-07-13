import { describe, expect, it } from 'vitest';
import { safeStagedArtworkContentType, safeStagedArtworkUrl } from './staged-artwork-url';

describe('staged collection artwork URL safety', () => {
	it('allows known provider artwork hosts and removes fragments', () => {
		expect(safeStagedArtworkUrl('https://image.tmdb.org/t/p/w500/poster.jpg#preview')).toBe(
			'https://image.tmdb.org/t/p/w500/poster.jpg'
		);
		expect(safeStagedArtworkUrl('https://api.mediux.pro/assets/poster.jpg')).toBe(
			'https://api.mediux.pro/assets/poster.jpg'
		);
	});

	it('rejects internal, lookalike, credential-bearing, and non-http URLs', () => {
		for (const value of [
			'http://127.0.0.1/poster.jpg',
			'http://image.tmdb.org/t/p/w500/poster.jpg',
			'https://tmdb.org.evil.test/poster.jpg',
			'https://user:secret@image.tmdb.org/poster.jpg',
			'https://image.tmdb.org/poster.jpg?X-Plex-Token=secret',
			'https://image.tmdb.org/poster.jpg?access_token=secret',
			'file:///etc/passwd'
		]) {
			expect(safeStagedArtworkUrl(value), value).toBeNull();
		}
	});

	it('normalizes raster content types and rejects active or non-image responses', () => {
		expect(safeStagedArtworkContentType('image/jpeg; charset=binary')).toBe('image/jpeg');
		expect(safeStagedArtworkContentType('IMAGE/WEBP')).toBe('image/webp');
		expect(safeStagedArtworkContentType('image/svg+xml')).toBeNull();
		expect(safeStagedArtworkContentType('image/svg')).toBeNull();
		expect(safeStagedArtworkContentType('text/html')).toBeNull();
		expect(safeStagedArtworkContentType('application/octet-stream')).toBeNull();
	});
});

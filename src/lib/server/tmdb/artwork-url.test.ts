import { describe, expect, it } from 'vitest';
import {
	canonicalizeProviderArtworkUrl,
	canonicalizeTmdbArtworkUrl,
	equivalentProviderArtworkUrls
} from './artwork-url';

describe('TMDB artwork URL canonicalization', () => {
	it.each([
		[
			'https://image.tmdb.org/t/p/w500/poster_1.jpg',
			'https://image.tmdb.org/t/p/original/poster_1.jpg'
		],
		[
			'https://image.tmdb.org/t/p/w1280/backdrop-2.webp',
			'https://image.tmdb.org/t/p/original/backdrop-2.webp'
		],
		[
			'https://image.tmdb.org/t/p/h632/logo~3.png',
			'https://image.tmdb.org/t/p/original/logo~3.png'
		],
		[
			'HTTPS://IMAGE.TMDB.ORG/t/p/w780/MixedCase.jpg',
			'https://image.tmdb.org/t/p/original/MixedCase.jpg'
		]
	])('upgrades a trusted size URL and is idempotent', (input, expected) => {
		const canonical = canonicalizeTmdbArtworkUrl(input);
		expect(canonical).toBe(expected);
		expect(canonicalizeTmdbArtworkUrl(canonical)).toBe(canonical);
	});

	it.each([
		'http://image.tmdb.org/t/p/w500/poster.jpg',
		'https://user:secret@image.tmdb.org/t/p/w500/poster.jpg',
		'https://image.tmdb.org:443/t/p/w500/poster.jpg',
		'https://image.tmdb.org/t/p/w500/poster.jpg?api_key=secret',
		'https://image.tmdb.org/t/p/w500/poster.jpg#preview',
		'https://image.tmdb.org.evil.example/t/p/w500/poster.jpg',
		'https://image-tmdb.org/t/p/w500/poster.jpg',
		'https://evil.image.tmdb.org/t/p/w500/poster.jpg',
		'https://image.tmdb.org/T/P/w500/poster.jpg',
		'https://image.tmdb.org/t/p/500/poster.jpg',
		'https://image.tmdb.org/t/p/w0/poster.jpg',
		'https://image.tmdb.org/t/p/w500',
		'https://image.tmdb.org/t/p/w500/',
		'https://image.tmdb.org/t/p/w500/poster/extra.jpg',
		'https://image.tmdb.org/t/p/w500/../poster.jpg',
		'https://image.tmdb.org/t/p/w500/.',
		'https://image.tmdb.org/t/p/w500/..',
		'https://image.tmdb.org/t/p/w500/%2e%2e%2fposter.jpg',
		'https://image.tmdb.org/t/p/w500/poster%2Fextra.jpg',
		'https://image.tmdb.org/t/p/w500/poster%5Cextra.jpg',
		'https://image.tmdb.org/t/p/w500/poster\\extra.jpg',
		' https://image.tmdb.org/t/p/w500/poster.jpg',
		'https://image.tmdb.org/t/p/w500/poster.jpg\n'
	])('leaves an untrusted or unexpected URL byte-for-byte unchanged', (input) => {
		expect(canonicalizeTmdbArtworkUrl(input)).toBe(input);
	});

	it('requires TMDB provider provenance and preserves every other provider byte-for-byte', () => {
		const legacy = 'https://image.tmdb.org/t/p/w500/poster.jpg';
		expect(canonicalizeProviderArtworkUrl(legacy, 'tmdb')).toBe(
			'https://image.tmdb.org/t/p/original/poster.jpg'
		);
		expect(canonicalizeProviderArtworkUrl(legacy, null)).toBe(legacy);
		expect(canonicalizeProviderArtworkUrl(legacy, 'custom')).toBe(legacy);
		expect(canonicalizeProviderArtworkUrl(legacy, 'mediux')).toBe(legacy);
		expect(
			equivalentProviderArtworkUrls(
				legacy,
				'https://image.tmdb.org/t/p/original/poster.jpg',
				'tmdb'
			)
		).toBe(true);
		expect(
			equivalentProviderArtworkUrls(
				legacy,
				'https://image.tmdb.org/t/p/original/poster.jpg',
				'custom'
			)
		).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import { sanitizeNativeCollectionArtworkUrl } from './native-artwork-url';

describe('native collection artwork URL persistence', () => {
	it('removes Plex and Emby query credentials while retaining safe parameters', () => {
		expect(
			sanitizeNativeCollectionArtworkUrl(
				'https://plex.test/poster?width=300&X-Plex-Token=plex-secret'
			)
		).toBe('https://plex.test/poster?width=300');
		expect(
			sanitizeNativeCollectionArtworkUrl(
				'https://emby.test/image?API_KEY=emby-secret&tag=poster-tag'
			)
		).toBe('https://emby.test/image?tag=poster-tag');
	});

	it('removes encoded credential keys and URL user information', () => {
		expect(
			sanitizeNativeCollectionArtworkUrl(
				'https://user:password@server.test/image?%58-Plex-Token=secret&tag=ok'
			)
		).toBe('https://server.test/image?tag=ok');
	});

	it('discards values that cannot be confidently made credential-free', () => {
		expect(
			sanitizeNativeCollectionArtworkUrl(
				'https://server.test/image?tag=ok%3Bapi_key%3Dnested-secret'
			)
		).toBeNull();
		expect(sanitizeNativeCollectionArtworkUrl('not an absolute URL?api_key=secret')).toBeNull();
		expect(sanitizeNativeCollectionArtworkUrl('data:image/png;base64,abc')).toBeNull();
	});
});

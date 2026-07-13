import { describe, expect, it } from 'vitest';
import {
	authenticateServerArtworkUrl,
	safeArtworkRequestTarget,
	sanitizeServerArtworkUrl
} from './artwork-url';

describe('media-server artwork URL safety', () => {
	it('removes media-server and signed-URL credentials before persistence', () => {
		expect(
			sanitizeServerArtworkUrl(
				'https://user:pass@server.test/image?tag=ok&X-Plex-Token=plex-secret&X-Amz-Signature=aws-secret'
			)
		).toBe('https://server.test/image?tag=ok');
	});

	it('rehydrates credentials only for the configured server origin and base path', () => {
		expect(
			authenticateServerArtworkUrl({
				serverType: 'jellyfin',
				baseUrl: 'https://media.test/jellyfin',
				credential: 'private-key',
				storedUrl: 'https://media.test/jellyfin/Items/1/Images/Primary?tag=v1'
			})
		).toBe('https://media.test/jellyfin/Items/1/Images/Primary?tag=v1&api_key=private-key');
		expect(
			authenticateServerArtworkUrl({
				serverType: 'plex',
				baseUrl: 'https://media.test',
				credential: 'private-token',
				storedUrl: 'https://attacker.test/image'
			})
		).toBeNull();
	});

	it('formats request errors without query values', () => {
		expect(safeArtworkRequestTarget('https://server.test/image?api_key=private')).toBe(
			'https://server.test/image'
		);
	});
});

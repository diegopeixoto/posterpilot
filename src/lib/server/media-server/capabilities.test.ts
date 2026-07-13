import { describe, expect, it } from 'vitest';
import {
	defaultMediaServerCapabilities,
	mediaServerIdentity,
	normalizeMediaServerCapabilities
} from './capabilities';

describe('media-server capability normalization', () => {
	it('publishes conservative provider contracts without inferring unsupported operations', () => {
		expect(defaultMediaServerCapabilities('plex')).toMatchObject({
			posterWrite: 'supported',
			backgroundWrite: 'supported',
			fieldLock: 'supported',
			currentImageRetrieval: 'supported',
			artworkDelete: 'unsupported',
			nativeCollectionDiscovery: 'supported',
			collectionArtwork: 'supported',
			evidence: 'provider_contract'
		});
		expect(defaultMediaServerCapabilities('jellyfin')).toMatchObject({
			fieldLock: 'unsupported',
			artworkDelete: 'supported'
		});
	});

	it('normalizes stored boolean and string capabilities while retaining safe defaults', () => {
		expect(
			normalizeMediaServerCapabilities('emby', {
				posterWrite: false,
				backgroundWrite: 'supported',
				nativeCollectionDiscovery: false,
				evidence: 'verified',
				limitations: ['poster_write_disabled', 42]
			})
		).toEqual({
			posterWrite: 'unsupported',
			backgroundWrite: 'supported',
			seasonWrite: 'supported',
			episodeWrite: 'supported',
			fieldLock: 'unsupported',
			currentImageRetrieval: 'supported',
			artworkDelete: 'supported',
			nativeCollectionDiscovery: 'unsupported',
			collectionArtwork: 'supported',
			evidence: 'verified',
			limitations: ['poster_write_disabled']
		});
	});

	it('normalizes concrete non-secret instance identity', () => {
		expect(mediaServerIdentity('plex', 'server-plex', '  Cinema  ')).toEqual({
			instanceId: 'server-plex',
			name: 'Cinema',
			type: 'plex'
		});
		expect(mediaServerIdentity('jellyfin')).toEqual({
			instanceId: null,
			name: null,
			type: 'jellyfin'
		});
	});
});

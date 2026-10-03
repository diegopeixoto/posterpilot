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
			fieldLock: 'supported',
			artworkDelete: 'supported'
		});
		expect(
			defaultMediaServerCapabilities('jellyfin').limitations.includes('field_lock_not_applicable')
		).toBe(false);
	});

	it('declares the item-level lock contract and its metadata scope for Jellyfin/Emby', () => {
		const limitations = defaultMediaServerCapabilities('jellyfin').limitations;
		expect(limitations).toContain('field_lock_item_level');
		expect(limitations).toContain('field_lock_blocks_item_metadata_refresh');
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
			fieldLock: 'supported',
			currentImageRetrieval: 'supported',
			artworkDelete: 'supported',
			nativeCollectionDiscovery: 'unsupported',
			collectionArtwork: 'supported',
			evidence: 'verified',
			limitations: ['poster_write_disabled']
		});
	});

	it('lets the shipped field-lock contract override a stale stored cache', () => {
		// Capabilities stored per instance are a snapshot of what the code believed at
		// connect time. The Jellyfin/Emby fieldLock contract changed from "no lock
		// concept" to LockData, so a pre-upgrade cache must not keep locking disabled.
		expect(
			normalizeMediaServerCapabilities('jellyfin', { fieldLock: 'unsupported' }).fieldLock
		).toBe('supported');
		expect(normalizeMediaServerCapabilities('emby', { fieldLock: false }).fieldLock).toBe(
			'supported'
		);
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

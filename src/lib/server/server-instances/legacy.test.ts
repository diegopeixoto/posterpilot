import { describe, expect, it } from 'vitest';
import { legacyServerConnectionFromConfig, type LegacyConfigurationSource } from './legacy';

const base: LegacyConfigurationSource = {
	serverType: 'plex',
	plexUrl: 'http://plex:32400',
	plexToken: 'plex-token',
	plexClientId: 'client-id',
	jellyfinUrl: 'http://jellyfin:8096',
	jellyfinApiKey: 'jellyfin-key',
	embyUrl: 'http://emby:8096',
	embyApiKey: 'emby-key'
};

describe('legacy server connection selection', () => {
	it('selects only the effective Plex values and retains its client id', () => {
		expect(legacyServerConnectionFromConfig(base)).toEqual({
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'plex-token',
			connectionSettings: { plexClientId: 'client-id' }
		});
	});

	it('does not borrow credentials from another provider', () => {
		expect(
			legacyServerConnectionFromConfig({
				...base,
				serverType: 'jellyfin',
				jellyfinApiKey: null
			})
		).toEqual({
			type: 'jellyfin',
			baseUrl: 'http://jellyfin:8096',
			credential: null,
			connectionSettings: null
		});

		expect(legacyServerConnectionFromConfig({ ...base, serverType: 'emby' })).toEqual({
			type: 'emby',
			baseUrl: 'http://emby:8096',
			credential: 'emby-key',
			connectionSettings: null
		});
	});
});

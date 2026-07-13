import type { ServerInstanceType } from './validation';

export const LEGACY_SERVER_INSTANCE_ID = 'legacy-default';
export const LEGACY_SERVER_INSTANCE_NAME = 'Default server';

/** Structural subset of AppConfig kept pure so tests do not import `$env`. */
export interface LegacyConfigurationSource {
	serverType: ServerInstanceType;
	plexUrl: string | null;
	plexToken: string | null;
	plexClientId?: string | null;
	jellyfinUrl: string | null;
	jellyfinApiKey: string | null;
	embyUrl: string | null;
	embyApiKey: string | null;
}

export interface LegacyServerConnection {
	type: ServerInstanceType;
	baseUrl: string | null;
	credential: string | null;
	connectionSettings: Record<string, unknown> | null;
}

/** Select exactly the effective legacy connection for the configured provider. */
export function legacyServerConnectionFromConfig(
	config: LegacyConfigurationSource
): LegacyServerConnection {
	switch (config.serverType) {
		case 'jellyfin':
			return {
				type: 'jellyfin',
				baseUrl: config.jellyfinUrl,
				credential: config.jellyfinApiKey,
				connectionSettings: null
			};
		case 'emby':
			return {
				type: 'emby',
				baseUrl: config.embyUrl,
				credential: config.embyApiKey,
				connectionSettings: null
			};
		case 'plex':
		default:
			return {
				type: 'plex',
				baseUrl: config.plexUrl,
				credential: config.plexToken,
				connectionSettings: config.plexClientId ? { plexClientId: config.plexClientId } : null
			};
	}
}

/**
 * Media-server provider factory + public surface of the module.
 *
 * `getActiveServer(config)` constructs the provider for the configured server
 * type with its credentials bound. The whole app (sync, discover, apply, the
 * settings test) obtains a `MediaServer` from here and never imports a provider
 * directly.
 */

import { requiredKeysFor, type AppConfig, type ServerType } from '$lib/server/config';
import { plexProvider } from './plex';
import { embyLikeProvider } from './emby';
import type { MediaServer } from './types';

export type {
	MediaServer,
	ServerType,
	ServerItem,
	ServerChild,
	ServerLibrary,
	ConnectionResult,
	ConnectionCandidate,
	LockField
} from './types';

/** Which config keys the active server type needs (re-exported for callers). */
export { requiredKeysFor } from '$lib/server/config';

/** Result of attempting to resolve the active provider. */
export interface ActiveServerResult {
	server: MediaServer | null;
	/** Config keys that are missing for the active type; empty when `server` is set. */
	missing: string[];
}

/**
 * Resolve the active provider for the configured server type, binding its
 * credentials. Returns `{ server: null, missing }` when those credentials are
 * absent rather than producing a half-configured client.
 */
export function resolveActiveServer(config: AppConfig): ActiveServerResult {
	const required = requiredKeysFor(config.serverType);
	const missing = required.filter((k) => {
		const v = config[k];
		return v === null || v === undefined || v === '';
	});
	if (missing.length) return { server: null, missing };

	switch (config.serverType) {
		case 'plex':
			return { server: plexProvider(config.plexUrl!, config.plexToken!), missing: [] };
		case 'jellyfin':
			return {
				server: embyLikeProvider(config.jellyfinUrl!, config.jellyfinApiKey!, 'jellyfin'),
				missing: []
			};
		case 'emby':
			return {
				server: embyLikeProvider(config.embyUrl!, config.embyApiKey!, 'emby'),
				missing: []
			};
		default:
			return { server: null, missing: required };
	}
}

/**
 * Convenience accessor: the active `MediaServer`, or null when unconfigured.
 * Use {@link resolveActiveServer} when the missing keys matter.
 */
export function getActiveServer(config: AppConfig): MediaServer | null {
	return resolveActiveServer(config).server;
}

/** A short human label for a server type (for messages / UI). */
export function serverTypeLabel(type: ServerType): string {
	switch (type) {
		case 'jellyfin':
			return 'Jellyfin';
		case 'emby':
			return 'Emby';
		case 'plex':
		default:
			return 'Plex';
	}
}

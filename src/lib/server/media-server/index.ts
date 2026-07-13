/**
 * Media-server provider factory + public surface of the module.
 *
 * `createMediaServer(connection)` constructs the provider for one explicit
 * server instance with its credentials bound. The whole app (sync, discover,
 * apply, the settings test) obtains a `MediaServer` from here and never
 * imports a provider directly.
 */

import type { ServerType } from '$lib/server/config';
import { plexProvider } from './plex';
import { embyLikeProvider } from './emby';
import { mediaServerIdentity, normalizeMediaServerCapabilities } from './capabilities';
import type { MediaServer } from './types';

export type {
	MediaServer,
	ServerType,
	ServerItem,
	ServerChild,
	ServerLibrary,
	ServerNativeCollection,
	ServerNativeCollectionMember,
	ConnectionResult,
	ConnectionCandidate,
	LockField,
	MediaServerIdentity,
	MediaServerCapabilities,
	CapabilitySupport,
	ServerArtwork,
	ServerArtworkKind
} from './types';

/** Credentials-bound input used by the named-server registry. */
export interface MediaServerConnection {
	instanceId?: string | null;
	name?: string | null;
	type: ServerType;
	baseUrl: string;
	credential: string;
	capabilities?: Record<string, unknown> | null;
}

/**
 * Construct a provider for one explicit server instance. Keeping this factory here
 * prevents apply/jobs from importing provider implementations or falling back to
 * whichever legacy server happens to be active.
 */
export function createMediaServer(connection: MediaServerConnection): MediaServer {
	const context = {
		identity: mediaServerIdentity(connection.type, connection.instanceId, connection.name),
		capabilities: normalizeMediaServerCapabilities(connection.type, connection.capabilities)
	};
	switch (connection.type) {
		case 'plex':
			return plexProvider(connection.baseUrl, connection.credential, context);
		case 'jellyfin':
			return embyLikeProvider(connection.baseUrl, connection.credential, 'jellyfin', context);
		case 'emby':
			return embyLikeProvider(connection.baseUrl, connection.credential, 'emby', context);
	}
}

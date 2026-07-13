import { hashCanonicalJson } from './canonical-json';
import { createMediaServer, type MediaServer } from '$lib/server/media-server';
import { getServerInstanceConnection } from '$lib/server/server-instances';

/** One credentials-bound provider plus a non-secret identity used for stale checks. */
export interface ApplyServerBinding {
	serverInstanceId: string;
	server: MediaServer;
	fingerprint: string;
}

/** Apply planning/execution never resolves an implicit global provider. */
export interface ApplyServerRegistry {
	resolve(serverInstanceId: string): Promise<ApplyServerBinding>;
}

/** Runtime registry backed by encrypted named server instances. */
export function createDatabaseApplyServerRegistry(): ApplyServerRegistry {
	return {
		async resolve(serverInstanceId) {
			const connection = await getServerInstanceConnection(serverInstanceId, {
				requireEnabled: true
			});
			if (!connection.baseUrl || !connection.credential) {
				throw new Error(`Server instance ${serverInstanceId} is not configured`);
			}

			return {
				serverInstanceId,
				server: createMediaServer({
					instanceId: connection.id,
					name: connection.name,
					type: connection.type,
					baseUrl: connection.baseUrl,
					credential: connection.credential,
					capabilities: connection.capabilities
				}),
				// A credential replacement advances updatedAt, so it invalidates the
				// fingerprint without ever hashing or persisting the secret itself.
				fingerprint: hashCanonicalJson({
					id: connection.id,
					type: connection.type,
					baseUrl: connection.baseUrl,
					enabled: connection.enabled,
					capabilities: connection.capabilities,
					updatedAt: connection.updatedAt.toISOString()
				})
			};
		}
	};
}

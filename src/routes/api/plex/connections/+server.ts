import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensurePlexClientId, resolveConfig } from '$lib/server/config';
import { listConnections, PlexAuthError } from '$lib/server/media-server/plex-auth';

/**
 * Discover the user's Plex servers and their connections (local/remote/relay).
 * Requires a stored Plex token; reports 409 when a login is needed first.
 */
export const GET: RequestHandler = async () => {
	const config = await resolveConfig();
	if (!config.plexToken) {
		return json({ error: 'A Plex login is required first.' }, { status: 409 });
	}
	try {
		const clientId = await ensurePlexClientId();
		const connections = await listConnections(config.plexToken, clientId);
		return json({ connections });
	} catch (e) {
		// Only curated plex.tv error text is safe to surface; anything else stays generic.
		const message =
			e instanceof PlexAuthError ? e.message : 'Plex server discovery failed unexpectedly.';
		return json({ error: message }, { status: 502 });
	}
};

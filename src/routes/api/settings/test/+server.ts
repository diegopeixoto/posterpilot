import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { resolveTmdb } from '$lib/server/tmdb/client';
import { getActiveServerInstance, resolveMediaServerInstance } from '$lib/server/server-instances';

/** Test connectivity to the active media server and TMDB using the effective config. */
export const POST: RequestHandler = async () => {
	const config = await resolveConfig();
	const active = await getActiveServerInstance();
	let serverType = config.serverType;
	let plex: { ok: boolean; error?: string; serverName?: string; version?: string };
	if (!active) {
		plex = { ok: false, error: 'server_instance_not_found' };
	} else {
		try {
			const resolved = await resolveMediaServerInstance(active.id, { requireEnabled: true });
			serverType = resolved.connection.type;
			const result = await resolved.server.testConnection();
			plex = result.ok
				? result
				: {
						ok: false,
						error: result.unauthorized ? 'connection_unauthorized' : 'connection_unreachable'
					};
		} catch {
			plex = { ok: false, error: 'connection_unreachable' };
		}
	}

	let tmdb: { ok: boolean; error?: string };
	if (!config.tmdbKey) {
		tmdb = { ok: false, error: 'credential_missing' };
	} else {
		try {
			// A well-known TMDB id (Fight Club) round-trips auth + classification.
			const res = await resolveTmdb({ tmdb: '550' }, config.tmdbKey, { cacheTtlDays: 0 });
			tmdb = res ? { ok: true } : { ok: false, error: 'connection_unreachable' };
		} catch {
			tmdb = { ok: false, error: 'connection_unreachable' };
		}
	}

	return json({ serverType, plex, tmdb });
};

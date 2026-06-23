import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedLibraries, resolveConfig, setCachedLibraries } from '$lib/server/config';
import { resolveActiveServer, serverTypeLabel } from '$lib/server/media-server';

/** Bound the library fetch so a slow/unreachable server can't hang the request. */
const LIST_TIMEOUT_MS = 8000;

/** List the active server's movie/show libraries (for choosing which to sync). */
export const GET: RequestHandler = async () => {
	const config = await resolveConfig();
	const { server, missing } = resolveActiveServer(config);
	if (!server) {
		return json({
			sections: await getCachedLibraries(),
			error: `${serverTypeLabel(config.serverType)} not configured (missing: ${missing.join(', ')})`
		});
	}
	try {
		const sections = await Promise.race([
			server.listLibraries(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Timed out listing libraries')), LIST_TIMEOUT_MS)
			)
		]);
		// Refresh the cache so the next Settings load renders instantly.
		await setCachedLibraries(sections);
		return json({ sections });
	} catch (e) {
		// On failure/timeout, fall back to the cached list and surface the error so the
		// UI can keep the existing checklist + selection while showing what went wrong.
		const sections = await getCachedLibraries();
		return json({ sections, error: e instanceof Error ? e.message : String(e) });
	}
};

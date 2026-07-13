import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedLibraries, setCachedLibraries } from '$lib/server/config';
import { getActiveServerInstance, resolveMediaServerInstance } from '$lib/server/server-instances';

/** Bound the library fetch so a slow/unreachable server can't hang the request. */
const LIST_TIMEOUT_MS = 8000;

/** List the active server's movie/show libraries (for choosing which to sync). */
export const GET: RequestHandler = async () => {
	const active = await getActiveServerInstance();
	if (!active) {
		return json({
			sections: [],
			error: 'server_instance_not_found'
		});
	}
	try {
		const { server } = await resolveMediaServerInstance(active.id, { requireEnabled: true });
		const sections = await Promise.race([
			server.listLibraries(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Timed out listing libraries')), LIST_TIMEOUT_MS)
			)
		]);
		// Refresh the cache so the next Settings load renders instantly.
		await setCachedLibraries(sections, active.id);
		return json({ sections });
	} catch {
		// On failure/timeout, fall back to the cached list and surface the error so the
		// UI can keep the existing checklist + selection while showing what went wrong.
		const sections = await getCachedLibraries(active.id);
		return json({ sections, error: 'connection_unreachable' });
	}
};

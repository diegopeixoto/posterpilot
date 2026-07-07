import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getStats, listActiveJobs, listJobs } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';
import { getActiveServer } from '$lib/server/media-server';

export const load: PageServerLoad = async () => {
	// First-run redirect: a brand-new install (no media server, no TMDB key) is
	// sent to the wizard. The wizard is skippable, so this only fires while truly
	// unconfigured.
	const config = await resolveConfig();
	if (!getActiveServer(config) && !config.tmdbKey) {
		redirect(307, '/setup');
	}
	// These three queries are independent — run them concurrently.
	const [stats, activeJobsList, jobs] = await Promise.all([
		getStats(),
		// All pending/running jobs get live progress + cancel on the dashboard.
		listActiveJobs(),
		listJobs(8)
	]);
	return { stats, activeJobsList, jobs };
};

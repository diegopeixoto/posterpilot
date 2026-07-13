import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getStats, listActiveJobs, listJobs } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';
import { isSetupDismissed } from '$lib/server/setup-state';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { getReviewDashboardSummary } from '$lib/server/review';
import { buildReviewDashboardSummary } from '$lib/server/review/dashboard-summary';

export const load: PageServerLoad = async () => {
	// First-run redirect: a brand-new install (no media server, no TMDB key) is
	// sent to the wizard. The wizard is skippable, so this only fires while truly
	// unconfigured.
	const config = await resolveConfig();
	const activeServerInstance = await getActiveServerInstance();
	if (!activeServerInstance && !config.tmdbKey && !(await isSetupDismissed())) {
		redirect(307, '/setup');
	}
	// These queries are independent — run them concurrently.
	const emptyStats = {
		total: 0,
		movies: 0,
		shows: 0,
		resolved: 0,
		withCandidates: 0,
		withMediux: 0,
		appliedCount: 0
	};
	const [stats, activeJobsList, jobs, review] = await Promise.all([
		activeServerInstance ? getStats(activeServerInstance.id) : Promise.resolve(emptyStats),
		// All pending/running jobs get live progress + cancel on the dashboard.
		activeServerInstance ? listActiveJobs(activeServerInstance.id) : Promise.resolve([]),
		activeServerInstance ? listJobs(8, activeServerInstance.id) : Promise.resolve([]),
		activeServerInstance
			? getReviewDashboardSummary(activeServerInstance.id)
			: Promise.resolve(buildReviewDashboardSummary([], [], 0))
	]);
	return {
		stats,
		activeJobsList,
		jobs,
		review,
		activeServerInstanceId: activeServerInstance?.id ?? null
	};
};

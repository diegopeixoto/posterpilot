import type { PageServerLoad } from './$types';
import { publicConfig, getCachedLibraries } from '$lib/server/config';
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '$lib/i18n/resolve';
import { hasCompletedSyncJob } from '$lib/server/queries';
import { deriveSetupResumeStep } from '$lib/setup-progress';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async ({ locals }) => {
	const active = await getActiveServerInstance();
	const [config, sections, successfulSync] = await Promise.all([
		publicConfig(active?.id),
		active ? getCachedLibraries(active.id) : Promise.resolve([]),
		active ? hasCompletedSyncJob(active.id) : Promise.resolve(false)
	]);
	return {
		config,
		// Last-known library list so the "Libraries" step renders the checklist
		// instantly; the step refreshes it live on mount.
		sections,
		resumeStep: deriveSetupResumeStep(config, {
			cachedLibraryCount: sections.length,
			successfulSync
		}),
		successfulSync,
		locale: locals.locale,
		availableLocales: SUPPORTED_LOCALES.map((code) => ({ code, name: LOCALE_NAMES[code] }))
	};
};

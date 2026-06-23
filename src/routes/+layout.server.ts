import type { LayoutServerLoad } from './$types';
import { resolveConfig } from '$lib/server/config';
import { getActiveServer } from '$lib/server/media-server';
import { activeJobCount } from '$lib/server/queries';
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '$lib/i18n/resolve';
import { version } from '$lib/version';

export const load: LayoutServerLoad = async ({ locals }) => {
	const config = await resolveConfig();
	return {
		activeJobs: await activeJobCount(),
		version,
		// Ready when the active media server is configured and TMDB is set.
		configReady: Boolean(getActiveServer(config) && config.tmdbKey),
		// Active locale (resolved per request in hooks.server.ts) plus the available
		// locales, so the header switcher and client runtime stay in sync with SSR.
		locale: locals.locale,
		availableLocales: SUPPORTED_LOCALES.map((code) => ({ code, name: LOCALE_NAMES[code] }))
	};
};

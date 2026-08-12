import type { LayoutServerLoad } from './$types';
import { resolveConfig } from '$lib/server/config';
import { activeJobCount } from '$lib/server/queries';
import { listManagedServers } from '$lib/server/server-instances';
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '$lib/i18n/resolve';
import { maintenanceMode } from '$lib/server/maintenance';
import { version } from '$lib/version';
import { getTmdbRepairState } from '$lib/server/tmdb/repair';
import { getAppearanceState } from '$lib/server/appearance';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [config, serverManagement, appearance] = await Promise.all([
		resolveConfig(),
		listManagedServers(),
		// The theme hook already read this for the SSR `<html>` injection; fall
		// back to a read of our own for any request that skipped the hook.
		locals.appearance ?? getAppearanceState()
	]);
	const [activeJobs, tmdbRepair] = serverManagement.activeServerId
		? await Promise.all([
				activeJobCount(serverManagement.activeServerId),
				getTmdbRepairState(serverManagement.activeServerId)
			])
		: [0, { pendingCount: 0, job: null }];
	const selectableServers = serverManagement.servers.filter(
		(server) => server.enabled && !server.disconnectedAt
	);
	return {
		activeJobs,
		tmdbRepair,
		version,
		// A staged restore put the app in maintenance mode: writes are rejected until
		// the process restarts, so every page shows the restart banner, not just Settings.
		maintenanceActive: Boolean(maintenanceMode()),
		// Ready when the active media server is configured and TMDB is set.
		configReady: Boolean(serverManagement.activeServerId && config.tmdbKey),
		serverSelection: {
			activeServerId: serverManagement.activeServerId,
			servers: selectableServers.map(({ id, name, type }) => ({ id, name, type }))
		},
		// Gates the "Fun" nav entry (the /fun route also 404s server-side when off).
		funEnabled: config.funEnabled,
		// Appearance: raw settings + custom themes for the Settings UI, and the
		// resolved appearance (same resolution the SSR html transform applied) for
		// nav placement and instant client-side theme switching.
		appearance,
		// Active locale (resolved per request in hooks.server.ts) plus the available
		// locales, so the header switcher and client runtime stay in sync with SSR.
		locale: locals.locale,
		availableLocales: SUPPORTED_LOCALES.map((code) => ({ code, name: LOCALE_NAMES[code] })),
		// Whether to show the logout control: auth is on and this request is a real
		// authenticated session (not the `disabled`/local-bypass passthrough).
		showLogout: locals.authMode !== 'disabled' && !!locals.authUser
	};
};

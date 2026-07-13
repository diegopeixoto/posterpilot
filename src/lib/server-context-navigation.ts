const SETTINGS_TABS = new Set([
	'server',
	'providers',
	'advanced',
	'diagnostics',
	'backup',
	'automation',
	'security',
	'language',
	'activity'
]);

/**
 * A global active-server change invalidates server-owned item, view, job and filter
 * identifiers. Keep only navigation state that is installation-global.
 */
export function canonicalPathAfterServerSwitch(url: URL): string {
	if (url.pathname.startsWith('/item/')) return '/library';
	if (/^\/collections\/[^/]+/.test(url.pathname)) return '/collections';
	if (url.pathname === '/settings') {
		const tab = url.searchParams.get('tab');
		return tab && SETTINGS_TABS.has(tab) ? `/settings?tab=${encodeURIComponent(tab)}` : '/settings';
	}
	return url.pathname;
}

/**
 * Live chrome layout — a tiny runes-based store shared by the Appearance
 * settings and the root layout.
 *
 * Nav placement is resolved on the server and arrives with the layout data, but
 * a theme can *force* a layout (Overseerr and Sonarr reskin around a sidebar).
 * Without this, picking one of those themes repainted the colors instantly while
 * the chrome stayed in the old arrangement until the next full page load.
 *
 * The override is client-only and deliberately not persisted: it exists for the
 * window between "the user picked a theme" and "the server data catches up".
 * `null` means "no local opinion — use what the server resolved".
 */
export type NavPlacement = 'top' | 'left';

let override = $state<NavPlacement | null>(null);

export const chrome = {
	/** The locally applied placement, or null to defer to the server's. */
	get navPlacement(): NavPlacement | null {
		return override;
	},

	/** Apply a placement immediately, before any navigation. */
	setNavPlacement(placement: NavPlacement): void {
		override = placement;
	},

	/** Drop the local opinion (used by tests; server data becomes authoritative). */
	reset(): void {
		override = null;
	}
};

/**
 * Theme-kit engine — client applier. Mirrors the SSR injection in
 * hooks.server.ts: sets `data-theme` and the resolved inline `--pp-*` variables
 * on `<html>`. Used by the Appearance settings UI for instant switching.
 */

import { TOKEN_KEYS, tokenVar } from './schema';
import type { ResolvedAppearance } from './resolve';

/**
 * Every custom property the resolver can put on `<html>`. Clearing from this
 * set rather than from a memo of what *this module* wrote is the point: the
 * first paint's variables come from the SSR injection, not from here, so a memo
 * starts empty and the first reset or theme switch removes none of them —
 * leaving a stale override in place, including on properties the newly selected
 * theme locks, until a reload.
 */
const MANAGED_VARS: string[] = [
	...TOKEN_KEYS.map(tokenVar),
	'--pp-background-image',
	'--pp-background-image-dim'
];

export function applyAppearance(resolved: ResolvedAppearance): void {
	const el = document.documentElement;
	el.dataset.theme = resolved.dataTheme;
	for (const key of MANAGED_VARS) {
		if (!(key in resolved.vars)) el.style.removeProperty(key);
	}
	for (const [key, value] of Object.entries(resolved.vars)) {
		el.style.setProperty(key, value);
	}

	// Theme-shipped CSS: upsert the same element the SSR injection renders.
	let themeCssEl = document.getElementById('pp-theme-css');
	if (!resolved.css) {
		themeCssEl?.remove();
	} else {
		if (!themeCssEl) {
			themeCssEl = document.createElement('style');
			themeCssEl.id = 'pp-theme-css';
			// Keep theme CSS before the user's own #pp-custom-css (user wins).
			const userCss = document.getElementById('pp-custom-css');
			document.head.insertBefore(themeCssEl, userCss ?? null);
		}
		themeCssEl.textContent = resolved.css;
	}
}

/**
 * Theme-kit engine — client applier. Mirrors the SSR injection in
 * hooks.server.ts: sets `data-theme` and the resolved inline `--pp-*` variables
 * on `<html>`. Used by the Appearance settings UI for instant switching;
 * previously applied inline vars that the new resolution dropped are removed.
 */

import type { ResolvedAppearance } from './resolve';

const appliedKeys = new Set<string>();

export function applyAppearance(resolved: ResolvedAppearance): void {
	const el = document.documentElement;
	el.dataset.theme = resolved.dataTheme;
	for (const key of appliedKeys) {
		if (!(key in resolved.vars)) el.style.removeProperty(key);
	}
	appliedKeys.clear();
	for (const [key, value] of Object.entries(resolved.vars)) {
		el.style.setProperty(key, value);
		appliedKeys.add(key);
	}
}

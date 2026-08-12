/**
 * Theme-kit engine — resolver. Pure: takes the stored appearance settings plus
 * any custom themes, returns exactly what the applier (SSR or client) needs —
 * the `data-theme` value and the inline `--pp-*` variables to set on `<html>`.
 *
 * Merge precedence: built-in base theme (via `data-theme` CSS block) → custom
 * theme token deltas (inline) → live user overrides (inline). User overrides
 * are capability-gated against the base theme's `customizable` flags: anything
 * the theme locks is discarded here, in exactly one place.
 */

import { findBuiltinTheme } from './presets';
import {
	DEFAULT_THEME_ID,
	TOKEN_KEYS,
	tokenVar,
	type ColorScheme,
	type CustomTheme,
	type CustomizableFlags,
	type Theme,
	type TokenKey
} from './schema';

export interface AppearanceInput {
	themeId?: string | null;
	accentOverride?: string | null;
	backgroundOverride?: string | null;
	backgroundImage?: string | null;
	backgroundImageDim?: number | null;
	radiusOverride?: string | null;
	navPlacement?: 'top' | 'left' | null;
}

export interface ResolvedAppearance {
	/** The id that was actually resolved (after fallback). */
	themeId: string;
	/** Value for the `data-theme` attribute (the base theme for custom themes). */
	dataTheme: string;
	colorScheme: ColorScheme;
	/** Capability flags of the effective base theme (drives the settings UI). */
	flags: CustomizableFlags;
	/** Effective chrome layout: the theme's forced layout wins over the setting. */
	navPlacement: 'top' | 'left';
	/** Inline custom properties to set on `<html>` (`--pp-*` → value). */
	vars: Record<string, string>;
}

/** Ramp derivation mirrors the `@theme inline` fallbacks in `app.css`. Emitting
 *  all stops inline beats any explicit stops a `[data-theme]` block set, which
 *  is what makes a single-color accent override work on every theme. */
const ACCENT_RAMP: Record<string, string> = {
	'accent-100': 'color-mix(in oklab, %COLOR%, white 88%)',
	'accent-200': 'color-mix(in oklab, %COLOR%, white 70%)',
	'accent-300': 'color-mix(in oklab, %COLOR%, white 45%)',
	'accent-400': 'color-mix(in oklab, %COLOR%, white 25%)',
	'accent-500': 'color-mix(in oklab, %COLOR%, white 10%)',
	'accent-600': '%COLOR%',
	'accent-700': 'color-mix(in oklab, %COLOR%, black 12%)',
	'accent-800': 'color-mix(in oklab, %COLOR%, black 25%)',
	'accent-900': 'color-mix(in oklab, %COLOR%, black 40%)',
	'accent-950': 'color-mix(in oklab, %COLOR%, black 65%)'
};

function accentRampVars(color: string): Record<string, string> {
	return Object.fromEntries(
		Object.entries(ACCENT_RAMP).map(([key, template]) => [
			tokenVar(key as TokenKey),
			template.replaceAll('%COLOR%', color)
		])
	);
}

function isHttpUrl(value: string): boolean {
	// Quotes are excluded so the value is always safe inside `url('...')` and an
	// HTML style attribute.
	return /^https?:\/\/[^\s"']+$/i.test(value);
}

interface ThemeLookup {
	/** Effective base theme (for custom themes: the base they extend). */
	base: Theme;
	/** Token deltas when the selected theme is a custom one. */
	deltas: CustomTheme['tokens'] | null;
	resolvedId: string;
}

function lookupTheme(themeId: string | null | undefined, customThemes: CustomTheme[]): ThemeLookup {
	const id = themeId ?? DEFAULT_THEME_ID;
	const builtin = findBuiltinTheme(id);
	if (builtin) return { base: builtin, deltas: null, resolvedId: builtin.id };

	const custom = customThemes.find((theme) => theme.id === id);
	if (custom) {
		const base = findBuiltinTheme(custom.base) ?? findBuiltinTheme(DEFAULT_THEME_ID)!;
		return { base, deltas: custom.tokens, resolvedId: custom.id };
	}

	const fallback = findBuiltinTheme(DEFAULT_THEME_ID)!;
	return { base: fallback, deltas: null, resolvedId: fallback.id };
}

export interface StoredAppearanceLike {
	themeId: string;
	themeAccentOverride: string | null;
	themeBackgroundOverride: string | null;
	themeBackgroundImage: string | null;
	themeBackgroundImageDim: number | null;
	themeRadiusOverride: string | null;
	navPlacement: 'top' | 'left';
}

/** Adapter for the stored settings shape (`theme*` key names) used by the
 *  server: hook SSR injection, layout load, and the appearance API. */
export function resolveStoredAppearance(
	stored: StoredAppearanceLike,
	customThemes: CustomTheme[] = []
): ResolvedAppearance {
	return resolveAppearance(
		{
			themeId: stored.themeId,
			accentOverride: stored.themeAccentOverride,
			backgroundOverride: stored.themeBackgroundOverride,
			backgroundImage: stored.themeBackgroundImage,
			backgroundImageDim: stored.themeBackgroundImageDim,
			radiusOverride: stored.themeRadiusOverride,
			navPlacement: stored.navPlacement
		},
		customThemes
	);
}

export function resolveAppearance(
	input: AppearanceInput,
	customThemes: CustomTheme[] = []
): ResolvedAppearance {
	const { base, deltas, resolvedId } = lookupTheme(input.themeId, customThemes);
	const flags = base.customizable;
	const vars: Record<string, string> = {};

	// Stage 1: custom theme deltas (authored against the base; applied as-is).
	// An accent delta expands to the full derived ramp — bases with explicit
	// accent stops (PosterPilot) would otherwise keep their own ramp.
	if (deltas) {
		for (const key of TOKEN_KEYS) {
			const value = deltas[key];
			if (!value) continue;
			if (key === 'accent-base') Object.assign(vars, accentRampVars(value));
			else vars[tokenVar(key)] = value;
		}
	}

	// Stage 2: live user overrides, capability-gated against the base theme.
	if (flags.accent && input.accentOverride) {
		Object.assign(vars, accentRampVars(input.accentOverride));
	}
	if (flags.background && input.backgroundOverride) {
		vars['--pp-background'] = input.backgroundOverride;
	}
	if (flags.backgroundImage && input.backgroundImage && isHttpUrl(input.backgroundImage)) {
		vars['--pp-background-image'] = `url('${input.backgroundImage}')`;
		const dim = input.backgroundImageDim;
		vars['--pp-background-image-dim'] = String(
			typeof dim === 'number' && Number.isFinite(dim) ? Math.min(1, Math.max(0, dim)) : 0.6
		);
	}
	if (flags.radius && input.radiusOverride) {
		vars['--pp-radius'] = input.radiusOverride;
		vars['--pp-radius-sm'] = `calc(${input.radiusOverride} / 2)`;
	}

	return {
		themeId: resolvedId,
		dataTheme: base.id,
		colorScheme: base.colorScheme,
		flags,
		navPlacement: base.layout === 'sidebar' ? 'left' : (input.navPlacement ?? 'top'),
		vars
	};
}

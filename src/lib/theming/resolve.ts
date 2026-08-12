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

import { readableForeground } from './contrast';
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
	/** Free-form CSS from the active custom theme (null for built-ins). Injected
	 *  before the user's own customCss, which still wins the cascade. */
	css: string | null;
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
	const vars: Record<string, string> = Object.fromEntries(
		Object.entries(ACCENT_RAMP).map(([key, template]) => [
			tokenVar(key as TokenKey),
			template.replaceAll('%COLOR%', color)
		])
	);
	// A theme's `accent-foreground` is paired with *its* accent. Once the accent
	// moves the pair goes stale — a light accent under the default white
	// foreground is an unreadable button — so re-derive it from the new color.
	// An explicit `accent-foreground` delta still wins: it is applied after this
	// in the TOKEN_KEYS order, and a locked theme never reaches stage 2 at all.
	const foreground = readableForeground(color);
	if (foreground) vars[tokenVar('accent-foreground')] = foreground;
	// Keep the base in step with the ramp: theme CSS mixes its own shades off
	// `--pp-accent-base` (the seerr button gradient, the Sonarr active bar), and
	// leaving it at the theme's original value would strand those on the old hue.
	vars[tokenVar('accent-base')] = color;
	return vars;
}

function isHttpUrl(value: string): boolean {
	// Quotes are excluded so the value is always safe inside `url('...')` and an
	// HTML style attribute.
	return /^https?:\/\/[^\s"']+$/i.test(value);
}

interface ThemeLookup {
	/** Theme whose `[data-theme]` block styles the page — for a custom theme the
	 *  base it extends, for a palette variant the built-in it varies. */
	base: Theme;
	/** Token deltas layered over the base block (variant palette or custom theme). */
	deltas: CustomTheme['tokens'] | null;
	/** Free-form CSS shipped with a custom theme (null for built-ins). */
	css: string | null;
	/** Capability flags that gate the user's overrides. A built-in states its own;
	 *  a custom theme can never widen what its base allows. */
	flags: CustomizableFlags;
	resolvedId: string;
}

function lookupTheme(themeId: string | null | undefined, customThemes: CustomTheme[]): ThemeLookup {
	const id = themeId ?? DEFAULT_THEME_ID;
	const builtin = findBuiltinTheme(id);
	if (builtin) {
		const base = builtin.variantOf ? (findBuiltinTheme(builtin.variantOf) ?? builtin) : builtin;
		return {
			base,
			deltas: builtin.variantOf ? (builtin.tokens ?? null) : null,
			css: null,
			flags: builtin.customizable,
			resolvedId: builtin.id
		};
	}

	const custom = customThemes.find((theme) => theme.id === id);
	if (custom) {
		const base = findBuiltinTheme(custom.base) ?? findBuiltinTheme(DEFAULT_THEME_ID)!;
		return {
			base,
			deltas: custom.tokens,
			css: custom.css ?? null,
			flags: base.customizable,
			resolvedId: custom.id
		};
	}

	const fallback = findBuiltinTheme(DEFAULT_THEME_ID)!;
	return {
		base: fallback,
		deltas: null,
		css: null,
		flags: fallback.customizable,
		resolvedId: fallback.id
	};
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
	const { base, deltas, css, flags, resolvedId } = lookupTheme(input.themeId, customThemes);
	const vars: Record<string, string> = {};

	// Stage 1: token deltas (a variant's palette or a custom theme's, applied as-is).
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
		vars,
		css
	};
}

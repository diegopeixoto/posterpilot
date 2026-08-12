/**
 * Theme-kit engine — authoring capture. Pure: decides what "save the current
 * appearance as a theme" actually writes.
 *
 * Both rules here exist because the obvious version silently destroyed data.
 * The Appearance controls expose three of the ~30 tokens a theme file can
 * carry, so a capture that returned *only* those wiped every other token of an
 * imported theme the moment its owner pressed "Update theme"; and a capture
 * that always folded in the user's instance CSS shipped that CSS to whoever
 * they shared the file with.
 */

import type { CustomizableFlags, CustomTheme } from './schema';

export interface CaptureTokensInput {
	/** Tokens the active custom theme already defines (empty for a built-in). */
	baseTokens: CustomTheme['tokens'];
	/** Capability flags of the effective base theme. */
	flags: CustomizableFlags;
	/** Live override values from the UI; empty string means "not set". */
	accent: string;
	background: string;
	radius: string;
}

/** The theme's own tokens, with the accepted live overrides layered on top. */
export function captureThemeTokens({
	baseTokens,
	flags,
	accent,
	background,
	radius
}: CaptureTokensInput): CustomTheme['tokens'] {
	const tokens: CustomTheme['tokens'] = { ...baseTokens };
	if (flags.accent && accent) tokens['accent-base'] = accent;
	if (flags.background && background) tokens.background = background;
	if (flags.radius && radius) tokens.radius = radius;
	return tokens;
}

export interface CaptureCssInput {
	/** Whether the user opted in to bundling their instance CSS. */
	includeCustomCss: boolean;
	customCss: string;
	/** CSS the active custom theme already ships. */
	themeCss?: string;
}

/** Bundling the user's own CSS is opt-in; opting out keeps whatever the theme
 *  already ships rather than dropping it. */
export function captureThemeCss({
	includeCustomCss,
	customCss,
	themeCss
}: CaptureCssInput): string | undefined {
	if (includeCustomCss && customCss.trim()) return customCss;
	return themeCss || undefined;
}

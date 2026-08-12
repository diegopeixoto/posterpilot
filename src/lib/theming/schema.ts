/**
 * Theme-kit engine — schema: the single source of truth for what a theme is.
 *
 * A theme is data: a complete token set (in CSS as `[data-theme]` blocks for
 * built-ins), a colorScheme, and `customizable` flags declaring which user
 * overrides it accepts. Custom (user-authored) themes extend a built-in base
 * with partial token deltas, so they always resolve to a complete token set.
 */

export const DEFAULT_THEME_ID = 'posterpilot';

/** Theme tokens, mirroring the `--pp-*` custom properties in `app.css`. */
export const TOKEN_KEYS = [
	'background',
	'surface',
	'surface-raised',
	'scrim',
	'text',
	'text-bright',
	'text-strong',
	'text-secondary',
	'text-muted',
	'text-faint',
	'border',
	'border-strong',
	'border-hover',
	'accent-base',
	'accent-foreground',
	'accent-100',
	'accent-200',
	'accent-300',
	'accent-400',
	'accent-500',
	'accent-600',
	'accent-700',
	'accent-800',
	'accent-900',
	'accent-950',
	'radius',
	'radius-sm',
	'font-sans'
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

/** Maps a token key to its CSS custom property name (`background` → `--pp-background`). */
export function tokenVar(key: TokenKey): string {
	return `--pp-${key}`;
}

export interface CustomizableFlags {
	accent: boolean;
	background: boolean;
	backgroundImage: boolean;
	radius: boolean;
}

export type ColorScheme = 'dark' | 'light';
export type ThemeFamily = 'base' | 'extreme';

/** A built-in theme. Token values live in `app.css` `[data-theme]` blocks;
 *  `swatches` drives the settings picker preview. */
export interface Theme {
	id: string;
	name: string;
	family: ThemeFamily;
	colorScheme: ColorScheme;
	customizable: CustomizableFlags;
	/** When set, the theme forces this chrome layout regardless of the user's
	 *  nav-placement setting (extreme themes reskin the layout, Winamp-style). */
	layout?: 'sidebar';
	/** [background, surface, accent] preview colors for the picker. */
	swatches: [string, string, string];
}

/** A user-authored theme: a base plus partial token deltas and metadata. */
export interface CustomTheme {
	/** `custom:<slug>` */
	id: string;
	name: string;
	author?: string;
	url?: string;
	version?: string;
	description?: string;
	/** Id of the built-in base theme this extends. */
	base: string;
	tokens: Partial<Record<TokenKey, string>>;
	/** Free-form CSS shipped with the theme (validated on import: size-capped,
	 *  no `</style>`). Applied while the theme is active, before the user's own
	 *  customCss, which still wins the cascade. */
	css?: string;
}

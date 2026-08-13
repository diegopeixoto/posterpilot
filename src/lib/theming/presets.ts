/**
 * Theme-kit engine — built-in themes. These are the typed registry entries:
 * identity, family, color scheme, capability flags, and picker swatches. The
 * actual token values live in `src/app.css` as `[data-theme='<id>']` blocks
 * (CSS is the runtime source of truth); `theming.test.ts` asserts the two
 * stay in sync.
 */

import type { Theme } from './schema';

const ALL_CUSTOMIZABLE = { accent: true, background: true, backgroundImage: true, radius: true };

interface TerminalPalette {
	id: string;
	name: string;
	background: string;
	surface: string;
	surfaceRaised: string;
	/** Scrim, well and chrome all take this darkest step. */
	sunken: string;
	text: string;
	textBright: string;
	textStrong: string;
	textSecondary: string;
	textMuted: string;
	textFaint: string;
	border: string;
	borderStrong: string;
	borderHover: string;
	accent: string;
	accentForeground: string;
}

/** Expand a terminal color scheme into a Terminal variant. Returns a one-element
 *  array so the entries spread inline and read as part of the list. */
function terminalVariant(palette: TerminalPalette): [Theme] {
	return [
		{
			id: palette.id,
			name: palette.name,
			family: 'extreme',
			colorScheme: 'dark',
			// Same locks as Terminal: the palette is the variation on offer, and its
			// background and zero radius are still the TUI identity.
			customizable: { accent: true, background: false, backgroundImage: false, radius: false },
			variantOf: 'terminal',
			tokens: {
				background: palette.background,
				surface: palette.surface,
				'surface-raised': palette.surfaceRaised,
				scrim: palette.sunken,
				well: palette.sunken,
				chrome: palette.sunken,
				'chrome-border': palette.border,
				text: palette.text,
				'text-bright': palette.textBright,
				'text-strong': palette.textStrong,
				'text-secondary': palette.textSecondary,
				'text-muted': palette.textMuted,
				'text-faint': palette.textFaint,
				border: palette.border,
				'border-strong': palette.borderStrong,
				'border-hover': palette.borderHover,
				'accent-base': palette.accent,
				'accent-foreground': palette.accentForeground
			},
			swatches: [palette.background, palette.surface, palette.accent]
		}
	];
}

export const BUILTIN_THEMES: Theme[] = [
	{
		id: 'posterpilot',
		name: 'PosterPilot',
		family: 'base',
		colorScheme: 'dark',
		customizable: { ...ALL_CUSTOMIZABLE },
		swatches: ['#0a0a0a', '#171717', '#7c3aed']
	},
	{
		id: 'darcula',
		name: 'Darcula',
		family: 'base',
		colorScheme: 'dark',
		customizable: { ...ALL_CUSTOMIZABLE },
		swatches: ['#2b2b2b', '#3c3f41', '#9876aa']
	},
	{
		id: 'monokai',
		name: 'Monokai',
		family: 'base',
		colorScheme: 'dark',
		customizable: { ...ALL_CUSTOMIZABLE },
		swatches: ['#272822', '#3e3d32', '#a6e22e']
	},
	{
		id: 'catppuccin',
		name: 'Catppuccin Mocha',
		family: 'base',
		colorScheme: 'dark',
		customizable: { ...ALL_CUSTOMIZABLE },
		swatches: ['#1e1e2e', '#313244', '#cba6f7']
	},
	{
		id: 'white',
		name: 'White',
		family: 'base',
		colorScheme: 'light',
		// Background and background image stay locked: light is the identity.
		customizable: { accent: true, background: false, backgroundImage: false, radius: true },
		swatches: ['#ffffff', '#f5f5f5', '#7c3aed']
	},
	{
		id: 'overseerr',
		name: 'Overseerr',
		family: 'extreme',
		colorScheme: 'dark',
		customizable: { ...ALL_CUSTOMIZABLE },
		// The seerr look is the left sidebar; the theme forces it.
		layout: 'sidebar',
		swatches: ['#111827', '#1f2937', '#4f46e5']
	},
	{
		id: 'sonarr',
		name: 'Sonarr/Radarr',
		family: 'extreme',
		colorScheme: 'dark',
		customizable: { ...ALL_CUSTOMIZABLE },
		// Sidebar chrome, matching the other extreme reskins.
		layout: 'sidebar',
		swatches: ['#222227', '#2f2f35', '#35c5f4']
	},
	{
		id: 'terminal',
		name: 'Terminal',
		family: 'extreme',
		colorScheme: 'dark',
		// Zero radius, pure black background, and no background image are the TUI
		// identity; only the phosphor accent may change.
		customizable: { accent: true, background: false, backgroundImage: false, radius: false },
		swatches: ['#000000', '#0a0a0a', '#33ff33']
	},
	// Terminal palette variants. They render under `data-theme="terminal"`, so
	// the whole TUI reskin — monospace, zero radius, scanlines, phosphor bloom,
	// block cursor — comes along and only the colors are restated here. Text
	// stops are lifted where the upstream scheme sits below AA on our surfaces
	// (`theme-contrast.test.ts` enforces the floor); the accent foreground is
	// the readable one for each accent.
	...terminalVariant({
		id: 'terminal-gruvbox',
		name: 'Terminal · Gruvbox',
		background: '#282828',
		surface: '#3c3836',
		surfaceRaised: '#504945',
		sunken: '#1d2021',
		text: '#ebdbb2',
		textBright: '#fbf1c7',
		textStrong: '#d5c4a1',
		textSecondary: '#d5c4a1',
		textMuted: '#c6b9a2',
		textFaint: '#afa28e',
		border: '#3c3836',
		borderStrong: '#504945',
		borderHover: '#665c54',
		accent: '#b8bb26',
		accentForeground: '#000000'
	}),
	...terminalVariant({
		id: 'terminal-nord',
		name: 'Terminal · Nord',
		background: '#2e3440',
		surface: '#3b4252',
		surfaceRaised: '#434c5e',
		sunken: '#272c36',
		text: '#eceff4',
		textBright: '#e5e9f0',
		textStrong: '#d8dee9',
		textSecondary: '#d8dee9',
		textMuted: '#c1c8d5',
		textFaint: '#a8b0be',
		border: '#434c5e',
		borderStrong: '#4c566a',
		borderHover: '#616e88',
		accent: '#88c0d0',
		accentForeground: '#000000'
	}),
	...terminalVariant({
		id: 'terminal-solarized',
		name: 'Terminal · Solarized',
		background: '#002b36',
		surface: '#073642',
		surfaceRaised: '#0e4b59',
		sunken: '#001f27',
		text: '#93a1a1',
		textBright: '#eee8d5',
		textStrong: '#b4c0c0',
		textSecondary: '#93a1a1',
		textMuted: '#a7b3b4',
		textFaint: '#889e9e',
		border: '#073642',
		borderStrong: '#0e4b59',
		borderHover: '#586e75',
		accent: '#268bd2',
		accentForeground: '#000000'
	})
];

export function findBuiltinTheme(id: string): Theme | undefined {
	return BUILTIN_THEMES.find((theme) => theme.id === id);
}

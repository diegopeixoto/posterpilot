/**
 * Theme-kit engine — built-in themes. These are the typed registry entries:
 * identity, family, color scheme, capability flags, and picker swatches. The
 * actual token values live in `src/app.css` as `[data-theme='<id>']` blocks
 * (CSS is the runtime source of truth); `theming.test.ts` asserts the two
 * stay in sync.
 */

import type { Theme } from './schema';

const ALL_CUSTOMIZABLE = { accent: true, background: true, backgroundImage: true, radius: true };

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
	}
];

export function findBuiltinTheme(id: string): Theme | undefined {
	return BUILTIN_THEMES.find((theme) => theme.id === id);
}

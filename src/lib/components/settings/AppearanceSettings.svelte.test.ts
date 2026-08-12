import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
// The real stylesheet, so computed style is the app's, not the browser default.
import '../../../app.css';
import { tick } from 'svelte';
import AppearanceSettings from './AppearanceSettings.svelte';
import { resolveAppearance } from '$lib/theming/resolve';
import type { CustomTheme } from '$lib/theming/schema';

/**
 * Component tests for the Appearance settings section, in a real browser.
 *
 * The engine logic (resolution, lock enforcement, file validation) is unit-tested
 * in `$lib/theming/*.test.ts`; what only a browser proves is that the picker and
 * override controls drive the live `data-theme` / inline-var application, and
 * that locked properties of a theme render no control at all.
 */

const DEFAULT_SETTINGS: {
	themeId: string;
	themeAccentOverride: string | null;
	themeBackgroundOverride: string | null;
	themeBackgroundImage: string | null;
	themeBackgroundImageDim: number | null;
	themeRadiusOverride: string | null;
	navPlacement: 'top' | 'left';
} = {
	themeId: 'posterpilot',
	themeAccentOverride: null,
	themeBackgroundOverride: null,
	themeBackgroundImage: null,
	themeBackgroundImageDim: null,
	themeRadiusOverride: null,
	navPlacement: 'top'
};

function mount(
	overrides: { settings?: Partial<typeof DEFAULT_SETTINGS>; customThemes?: CustomTheme[] } = {}
) {
	const settings = { ...DEFAULT_SETTINGS, ...overrides.settings };
	const customThemes = overrides.customThemes ?? [];
	render(AppearanceSettings, {
		initial: { settings, customThemes, resolved: resolveAppearance({}, []) }
	});
}

/** Theme picker buttons carry their theme name; find one by name. */
function themeButton(name: string): HTMLButtonElement {
	const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((el) =>
		el.textContent?.includes(name)
	);
	if (!button) throw new Error(`theme button not found: ${name}`);
	return button;
}

beforeEach(() => {
	// The applier writes to the shared document element; reset between tests.
	delete document.documentElement.dataset.theme;
	document.documentElement.removeAttribute('style');
});

describe('Appearance settings', () => {
	it('lists the 8 built-in themes grouped in two families, active theme pressed', async () => {
		mount();
		await tick();
		for (const name of [
			'PosterPilot',
			'Darcula',
			'Monokai',
			'Catppuccin Mocha',
			'White',
			'Overseerr',
			'Sonarr/Radarr',
			'Terminal'
		]) {
			expect(themeButton(name).getAttribute('aria-pressed')).toBe(
				name === 'PosterPilot' ? 'true' : 'false'
			);
		}
		expect(document.body.textContent).toContain('Base themes');
		expect(document.body.textContent).toContain('Extreme themes');
	});

	it('applies a selected theme to the document instantly', async () => {
		mount();
		await tick();
		themeButton('Darcula').click();
		await tick();
		expect(document.documentElement.dataset.theme).toBe('darcula');
		expect(themeButton('Darcula').getAttribute('aria-pressed')).toBe('true');
	});

	it('applies an accent override as a full inline ramp and resets it', async () => {
		mount({ settings: { themeAccentOverride: '#ff0000' } });
		await tick();
		const reset = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
			(el) => el.textContent?.trim() === 'Reset'
		)!;
		reset.click();
		await tick();
		// Reset reapplies the preset: the inline override vars are removed.
		expect(document.documentElement.style.getPropertyValue('--pp-accent-600')).toBe('');
	});

	it('shows no controls for properties the active theme locks', async () => {
		mount({ settings: { themeId: 'terminal' } });
		await tick();
		// Terminal locks background, background image, and radius; only the
		// phosphor accent swatches remain.
		expect(document.getElementById('appearance-radius')).toBeNull();
		expect(document.getElementById('appearance-bg-image')).toBeNull();
		expect(document.getElementById('appearance-background')).toBeNull();
		const phosphor = document.querySelector('button[aria-label="#33ff33"]');
		expect(phosphor).not.toBeNull();
	});

	it('renders the custom theme group when custom themes exist', async () => {
		mount({
			customThemes: [
				{
					id: 'custom:nebula',
					name: 'Nebula',
					base: 'catppuccin',
					version: '1.0.0',
					tokens: { 'accent-base': '#ff79c6' }
				}
			]
		});
		await tick();
		expect(document.body.textContent).toContain('Custom themes');
		expect(document.body.textContent).toContain('Nebula');
		expect(document.body.textContent).toContain('Catppuccin Mocha');
	});

	it('applies a custom theme over its base when selected', async () => {
		mount({
			customThemes: [
				{
					id: 'custom:nebula',
					name: 'Nebula',
					base: 'catppuccin',
					tokens: { 'accent-base': '#ff79c6' }
				}
			]
		});
		await tick();
		themeButton('Nebula').click();
		await tick();
		expect(document.documentElement.dataset.theme).toBe('catppuccin');
		expect(document.documentElement.style.getPropertyValue('--pp-accent-600')).toBe('#ff79c6');
	});
});

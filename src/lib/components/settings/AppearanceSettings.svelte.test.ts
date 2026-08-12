import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
// The real stylesheet, so computed style is the app's, not the browser default.
import '../../../app.css';
import { tick } from 'svelte';
import AppearanceSettings from './AppearanceSettings.svelte';
import { resolveAppearance } from '$lib/theming/resolve';
import type { CustomTheme } from '$lib/theming/schema';
import { chrome } from '$lib/stores/chrome.svelte';

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
	customCss: string | null;
} = {
	themeId: 'posterpilot',
	themeAccentOverride: null,
	themeBackgroundOverride: null,
	themeBackgroundImage: null,
	themeBackgroundImageDim: null,
	themeRadiusOverride: null,
	navPlacement: 'top',
	customCss: null
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
	chrome.reset();
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

describe('navigation placement', () => {
	/** The fieldset wrapping the two placement radios. */
	function placementFieldset(): HTMLFieldSetElement {
		const fieldset = document.querySelector<HTMLFieldSetElement>('fieldset');
		if (!fieldset) throw new Error('nav placement fieldset not found');
		return fieldset;
	}

	it('offers both placements as real radios for a theme with no forced layout', async () => {
		mount({ settings: { themeId: 'posterpilot', navPlacement: 'left' } });
		await tick();
		const fieldset = placementFieldset();
		expect(fieldset.disabled).toBe(false);
		const radios = [...fieldset.querySelectorAll<HTMLInputElement>('input[type=radio]')];
		expect(radios).toHaveLength(2);
		// Native radios: one name, so the browser gives arrow-key movement for free.
		expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
		expect(radios.find((radio) => radio.value === 'left')?.checked).toBe(true);
	});

	it('locks the control to the layout an extreme theme forces', async () => {
		// Overseerr reskins the chrome around a sidebar, and `resolveAppearance`
		// discards the setting — so the control must show that, not accept a click
		// the resolver will throw away.
		mount({ settings: { themeId: 'overseerr', navPlacement: 'top' } });
		await tick();
		const fieldset = placementFieldset();
		expect(fieldset.disabled).toBe(true);
		const radios = [...fieldset.querySelectorAll<HTMLInputElement>('input[type=radio]')];
		expect(radios.find((radio) => radio.value === 'left')?.checked).toBe(true);
		expect(radios.find((radio) => radio.value === 'top')?.checked).toBe(false);
	});
});

describe('live chrome layout', () => {
	it('rearranges the nav the moment a layout-forcing theme is picked', async () => {
		// Previously the colors repainted instantly and the chrome stayed in the old
		// arrangement until a full page load, because placement came only from the
		// server-rendered layout data.
		mount({ settings: { themeId: 'posterpilot', navPlacement: 'top' } });
		await tick();
		expect(chrome.navPlacement).toBeNull();

		themeButton('Overseerr').click();
		await tick();
		expect(chrome.navPlacement).toBe('left');

		themeButton('Darcula').click();
		await tick();
		expect(chrome.navPlacement).toBe('top');
	});
});

describe('theme CSS field', () => {
	const withCss: CustomTheme = {
		id: 'custom:neon',
		name: 'Neon',
		base: 'posterpilot',
		tokens: { 'accent-base': '#ff2d95' },
		css: '.surface { border-width: 2px }'
	};

	function themeCssBox(): HTMLTextAreaElement | null {
		return document.querySelector<HTMLTextAreaElement>('#appearance-theme-css');
	}

	it('does not offer a theme CSS box for a built-in theme', async () => {
		mount();
		await tick();
		expect(themeCssBox()).toBeNull();
	});

	it('shows the CSS an imported theme ships, apart from the instance CSS box', async () => {
		// Before this the theme's CSS applied unseen: there was nowhere to read it.
		mount({
			settings: { themeId: withCss.id, customCss: '.mine { color: red }' },
			customThemes: [withCss]
		});
		await tick();
		expect(themeCssBox()?.value).toBe('.surface { border-width: 2px }');
		// The instance box keeps its own content — the two never merge.
		const instance = document.querySelector<HTMLTextAreaElement>('#appearance-custom-css');
		expect(instance?.value).toBe('.mine { color: red }');
	});

	it('flags CSS that would load from another host', async () => {
		mount({ settings: { themeId: withCss.id }, customThemes: [withCss] });
		await tick();
		const box = themeCssBox()!;
		box.value = '@import url(https://evil.example/x.css);';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(box.getAttribute('aria-invalid')).toBe('true');
	});
});

import { describe, expect, it } from 'vitest';
import { captureThemeCss, captureThemeTokens } from './authoring';
import type { CustomizableFlags, CustomTheme } from './schema';

const ALL: CustomizableFlags = {
	accent: true,
	background: true,
	backgroundImage: true,
	radius: true
};

/** An imported theme carrying far more tokens than the UI can edit. */
const RICH: CustomTheme['tokens'] = {
	background: '#101014',
	surface: '#1b1b22',
	'surface-raised': '#26262f',
	text: '#e8e8f0',
	'text-muted': '#a8a8b8',
	border: '#2e2e38',
	'accent-base': '#ff79c6',
	radius: '0.5rem',
	'font-sans': 'Iosevka, monospace'
};

describe('captureThemeTokens', () => {
	it('keeps every token the theme already defines', () => {
		// The regression: pressing "Update theme" with no live override used to
		// replace a 9-token imported theme with an empty token map.
		expect(
			captureThemeTokens({
				baseTokens: RICH,
				flags: ALL,
				accent: '',
				background: '',
				radius: ''
			})
		).toEqual(RICH);
	});

	it('layers the live overrides over the theme tokens', () => {
		const captured = captureThemeTokens({
			baseTokens: RICH,
			flags: ALL,
			accent: '#33ff33',
			background: '',
			radius: '1rem'
		});
		expect(captured['accent-base']).toBe('#33ff33');
		expect(captured.radius).toBe('1rem');
		// Untouched controls leave the theme's own values alone.
		expect(captured.background).toBe('#101014');
		expect(captured['font-sans']).toBe('Iosevka, monospace');
	});

	it('captures nothing from a built-in base with no overrides set', () => {
		expect(
			captureThemeTokens({ baseTokens: {}, flags: ALL, accent: '', background: '', radius: '' })
		).toEqual({});
	});

	it('ignores overrides the base theme locks', () => {
		const locked: CustomizableFlags = {
			accent: true,
			background: false,
			backgroundImage: false,
			radius: false
		};
		const captured = captureThemeTokens({
			baseTokens: {},
			flags: locked,
			accent: '#ffb000',
			background: '#111111',
			radius: '1rem'
		});
		expect(captured).toEqual({ 'accent-base': '#ffb000' });
	});
});

describe('captureThemeCss', () => {
	it('leaves the user instance CSS out unless they opt in', () => {
		expect(
			captureThemeCss({ includeCustomCss: false, customCss: '.surface{border:0}' })
		).toBeUndefined();
		expect(captureThemeCss({ includeCustomCss: true, customCss: '.surface{border:0}' })).toBe(
			'.surface{border:0}'
		);
	});

	it('keeps the CSS a theme already ships when opting out', () => {
		expect(
			captureThemeCss({
				includeCustomCss: false,
				customCss: '.mine{}',
				themeCss: '.theirs{}'
			})
		).toBe('.theirs{}');
	});

	it('treats blank custom CSS as nothing to bundle', () => {
		expect(captureThemeCss({ includeCustomCss: true, customCss: '   ' })).toBeUndefined();
	});
});

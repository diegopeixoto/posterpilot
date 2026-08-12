import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILTIN_THEMES, findBuiltinTheme } from './presets';
import { resolveAppearance, resolveStoredAppearance } from './resolve';
import { TOKEN_KEYS, tokenVar, type CustomTheme } from './schema';

describe('theme registry', () => {
	it('ships the built-in themes in two families', () => {
		expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual([
			'posterpilot',
			'darcula',
			'monokai',
			'catppuccin',
			'white',
			'overseerr',
			'sonarr',
			'terminal',
			'terminal-gruvbox',
			'terminal-nord',
			'terminal-solarized'
		]);
		expect(new Set(BUILTIN_THEMES.map((theme) => theme.family))).toEqual(
			new Set(['base', 'extreme'])
		);
	});

	it('resolves a palette variant to its parent block plus token deltas', () => {
		const resolved = resolveAppearance({ themeId: 'terminal-nord' });
		// The variant renders as Terminal, so the whole TUI reskin applies to it.
		expect(resolved.dataTheme).toBe('terminal');
		expect(resolved.themeId).toBe('terminal-nord');
		expect(resolved.vars['--pp-background']).toBe('#2e3440');
		// An accent delta expands to the full ramp, as it does for a custom theme.
		expect(resolved.vars['--pp-accent-600']).toBe('#88c0d0');
		// The variant states its own locks rather than borrowing Terminal's object.
		expect(resolved.flags).toEqual({
			accent: true,
			background: false,
			backgroundImage: false,
			radius: false
		});
	});

	it('keeps a variant locked against the overrides its family forbids', () => {
		const resolved = resolveAppearance({
			themeId: 'terminal-gruvbox',
			backgroundOverride: '#ffffff',
			radiusOverride: '1rem',
			accentOverride: '#ffb000'
		});
		expect(resolved.vars['--pp-background']).toBe('#282828');
		expect(resolved.vars['--pp-radius']).toBeUndefined();
		expect(resolved.vars['--pp-accent-600']).toBe('#ffb000');
	});

	it('locks the identity properties of the White and Terminal themes', () => {
		expect(findBuiltinTheme('white')?.customizable).toEqual({
			accent: true,
			background: false,
			backgroundImage: false,
			radius: true
		});
		expect(findBuiltinTheme('terminal')?.customizable).toEqual({
			accent: true,
			background: false,
			backgroundImage: false,
			radius: false
		});
	});

	it('has a matching [data-theme] block in app.css for every built-in theme', () => {
		const cssPath = fileURLToPath(new URL('../../app.css', import.meta.url));
		const css = readFileSync(cssPath, 'utf8');
		// Palette variants carry no block of their own — that is the point of
		// them; they render under their parent's and only restate colors.
		for (const theme of BUILTIN_THEMES.filter((t) => !t.variantOf)) {
			const blockMatch = css.match(
				new RegExp(`\\[data-theme=['"]${theme.id}['"]\\]\\s*\\{([^}]*)\\}`)
			);
			expect(blockMatch, `missing [data-theme='${theme.id}'] block`).not.toBeNull();
			const block = blockMatch![1];
			// Accent stops beyond the base may fall back to the derived ramp; every
			// other token must be defined explicitly by the theme.
			const required = TOKEN_KEYS.filter(
				(key) => !/^accent-(100|200|300|400|500|600|700|800|900|950)$/.test(key)
			);
			for (const key of required) {
				expect(block, `${theme.id} missing ${tokenVar(key)}`).toContain(`${tokenVar(key)}:`);
			}
		}
	});

	it('points every palette variant at a real parent with known token keys', () => {
		for (const theme of BUILTIN_THEMES.filter((t) => t.variantOf)) {
			const parent = findBuiltinTheme(theme.variantOf!);
			expect(parent, `${theme.id} varies unknown theme ${theme.variantOf}`).toBeDefined();
			expect(parent!.variantOf, `${theme.id} varies another variant`).toBeUndefined();
			for (const key of Object.keys(theme.tokens ?? {})) {
				expect(TOKEN_KEYS, `${theme.id} sets unknown token ${key}`).toContain(key);
			}
		}
	});
});

describe('resolveAppearance', () => {
	it('resolves the default theme with no overrides', () => {
		const resolved = resolveAppearance({});
		expect(resolved.themeId).toBe('posterpilot');
		expect(resolved.dataTheme).toBe('posterpilot');
		expect(resolved.colorScheme).toBe('dark');
		expect(resolved.vars).toEqual({});
	});

	it('falls back to the default theme for an unknown id', () => {
		const resolved = resolveAppearance({ themeId: 'does-not-exist' });
		expect(resolved.themeId).toBe('posterpilot');
		expect(resolved.dataTheme).toBe('posterpilot');
	});

	it('emits a full accent ramp for an accepted accent override', () => {
		const resolved = resolveAppearance({ themeId: 'monokai', accentOverride: '#ff0000' });
		expect(resolved.vars['--pp-accent-600']).toBe('#ff0000');
		expect(resolved.vars['--pp-accent-500']).toBe('color-mix(in oklab, #ff0000, white 10%)');
		expect(resolved.vars['--pp-accent-950']).toBe('color-mix(in oklab, #ff0000, black 65%)');
		// The base moves with the ramp: theme CSS mixes its own shades off it.
		expect(resolved.vars['--pp-accent-base']).toBe('#ff0000');
	});

	it('re-derives a readable accent foreground when the accent changes', () => {
		// Monokai pairs its lime accent with dark text; a dark override must not
		// keep that pairing, or the primary button becomes black-on-navy.
		const dark = resolveAppearance({ themeId: 'monokai', accentOverride: '#1d1b6b' });
		expect(dark.vars['--pp-accent-foreground']).toBe('#ffffff');
		const light = resolveAppearance({ themeId: 'posterpilot', accentOverride: '#fde047' });
		expect(light.vars['--pp-accent-foreground']).toBe('#000000');
	});

	it('discards overrides the theme locks', () => {
		const resolved = resolveAppearance({
			themeId: 'terminal',
			accentOverride: '#ffb000',
			backgroundOverride: '#111111',
			backgroundImage: 'https://example.com/bg.png',
			radiusOverride: '1rem'
		});
		expect(resolved.vars['--pp-accent-600']).toBe('#ffb000');
		expect(resolved.vars['--pp-background']).toBeUndefined();
		expect(resolved.vars['--pp-background-image']).toBeUndefined();
		expect(resolved.vars['--pp-radius']).toBeUndefined();
	});

	it('applies a radius override with a scaled control radius', () => {
		const resolved = resolveAppearance({ themeId: 'darcula', radiusOverride: '0.25rem' });
		expect(resolved.vars['--pp-radius']).toBe('0.25rem');
		expect(resolved.vars['--pp-radius-sm']).toBe('calc(0.25rem / 2)');
	});

	it('accepts only http/https background image URLs and clamps the dim', () => {
		const rejected = resolveAppearance({
			themeId: 'posterpilot',
			backgroundImage: 'javascript:alert(1)'
		});
		expect(rejected.vars['--pp-background-image']).toBeUndefined();

		const accepted = resolveAppearance({
			themeId: 'posterpilot',
			backgroundImage: 'https://example.com/bg.png',
			backgroundImageDim: 4
		});
		expect(accepted.vars['--pp-background-image']).toBe("url('https://example.com/bg.png')");
		expect(accepted.vars['--pp-background-image-dim']).toBe('1');
	});

	const custom: CustomTheme = {
		id: 'custom:nebula',
		name: 'Nebula',
		base: 'catppuccin',
		tokens: { 'accent-base': '#ff79c6', surface: '#282a36' }
	};

	it('applies custom theme deltas over the base theme', () => {
		const resolved = resolveAppearance({ themeId: 'custom:nebula' }, [custom]);
		expect(resolved.themeId).toBe('custom:nebula');
		expect(resolved.dataTheme).toBe('catppuccin');
		// An accent-base delta expands to the full derived ramp.
		expect(resolved.vars['--pp-accent-600']).toBe('#ff79c6');
		expect(resolved.vars['--pp-accent-500']).toBe('color-mix(in oklab, #ff79c6, white 10%)');
		expect(resolved.vars['--pp-surface']).toBe('#282a36');
	});

	it('gates live overrides against the custom theme base flags', () => {
		const terminalCustom: CustomTheme = { ...custom, base: 'terminal', id: 'custom:tty' };
		const resolved = resolveAppearance({ themeId: 'custom:tty', radiusOverride: '1rem' }, [
			terminalCustom
		]);
		expect(resolved.dataTheme).toBe('terminal');
		expect(resolved.vars['--pp-radius']).toBeUndefined();
	});

	it('user overrides win over custom theme deltas', () => {
		const resolved = resolveAppearance({ themeId: 'custom:nebula', accentOverride: '#00ff00' }, [
			custom
		]);
		expect(resolved.vars['--pp-accent-600']).toBe('#00ff00');
	});

	it('falls back to the default theme when a custom theme base is unknown', () => {
		const orphan: CustomTheme = { ...custom, base: 'nope' };
		const resolved = resolveAppearance({ themeId: 'custom:nebula' }, [orphan]);
		expect(resolved.dataTheme).toBe('posterpilot');
		expect(resolved.themeId).toBe('custom:nebula');
	});

	it('adapts the stored settings shape (resolveStoredAppearance)', () => {
		const resolved = resolveStoredAppearance({
			themeId: 'darcula',
			themeAccentOverride: '#ff0000',
			themeBackgroundOverride: null,
			themeBackgroundImage: null,
			themeBackgroundImageDim: null,
			themeRadiusOverride: '0.25rem',
			navPlacement: 'left'
		});
		expect(resolved.dataTheme).toBe('darcula');
		expect(resolved.vars['--pp-accent-600']).toBe('#ff0000');
		expect(resolved.vars['--pp-radius']).toBe('0.25rem');
		expect(resolved.navPlacement).toBe('left');
	});

	it('honors the nav-placement setting for themes without a forced layout', () => {
		expect(resolveAppearance({ themeId: 'monokai', navPlacement: 'left' }).navPlacement).toBe(
			'left'
		);
		expect(resolveAppearance({ themeId: 'monokai' }).navPlacement).toBe('top');
	});

	it('carries the custom theme CSS through resolution', () => {
		const withCss: CustomTheme = { ...custom, css: '.surface { border-width: 2px }' };
		expect(resolveAppearance({ themeId: 'custom:nebula' }, [withCss]).css).toBe(
			'.surface { border-width: 2px }'
		);
		expect(resolveAppearance({ themeId: 'custom:nebula' }, [custom]).css).toBeNull();
		expect(resolveAppearance({ themeId: 'monokai' }).css).toBeNull();
	});

	it('lets a theme force its layout over the nav-placement setting', () => {
		for (const id of ['overseerr', 'sonarr']) {
			expect(resolveAppearance({ themeId: id, navPlacement: 'top' }).navPlacement).toBe('left');
		}
		const onOverseerrBase: CustomTheme = { ...custom, id: 'custom:seer', base: 'overseerr' };
		expect(
			resolveAppearance({ themeId: 'custom:seer', navPlacement: 'top' }, [onOverseerrBase])
				.navPlacement
		).toBe('left');
	});
});

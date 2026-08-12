import { describe, expect, it } from 'vitest';
import type { CustomTheme } from './schema';
import {
	isValidCss,
	isValidThemeCss,
	MAX_THEME_FILE_BYTES,
	parseCustomThemeInput,
	parseThemeFile,
	sanitizeCustomTheme,
	serializeThemeFile,
	THEME_FILE_FORMAT,
	THEME_FILE_FORMAT_VERSION
} from './theme-file';

const theme: CustomTheme = {
	id: 'custom:nebula',
	name: 'Nebula',
	author: 'Diego',
	url: 'https://example.com/nebula',
	version: '1.0.0',
	description: 'Purple haze.',
	base: 'catppuccin',
	tokens: { 'accent-base': '#ff79c6', surface: '#282a36', radius: '0.5rem' }
};

describe('serializeThemeFile / parseThemeFile round-trip', () => {
	it('round-trips a custom theme with its metadata', () => {
		const parsed = parseThemeFile(serializeThemeFile(theme));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.theme).toEqual({
			name: 'Nebula',
			author: 'Diego',
			url: 'https://example.com/nebula',
			version: '1.0.0',
			description: 'Purple haze.',
			base: 'catppuccin',
			tokens: { 'accent-base': '#ff79c6', surface: '#282a36', radius: '0.5rem' }
		});
	});

	it('round-trips theme CSS and rejects a style breakout', () => {
		const withCss: CustomTheme = { ...theme, css: '.surface { border-width: 2px }' };
		const parsed = parseThemeFile(serializeThemeFile(withCss));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.theme.css).toBe('.surface { border-width: 2px }');

		const evil = JSON.parse(serializeThemeFile(withCss));
		evil.theme.css = 'x {} </style><script>alert(1)</script>';
		expect(parseThemeFile(JSON.stringify(evil))).toEqual({ ok: false, error: 'invalid_css' });
	});

	it('omits absent optional metadata from the file', () => {
		const minimal: CustomTheme = { id: 'custom:m', name: 'M', base: 'monokai', tokens: {} };
		const doc = JSON.parse(serializeThemeFile(minimal));
		expect(doc.format).toBe(THEME_FILE_FORMAT);
		expect(doc.formatVersion).toBe(THEME_FILE_FORMAT_VERSION);
		expect(doc.theme).toEqual({ name: 'M', base: 'monokai', tokens: {} });
	});
});

describe('parseThemeFile rejection', () => {
	const wrap = (themeDoc: unknown) =>
		JSON.stringify({ format: THEME_FILE_FORMAT, formatVersion: 1, theme: themeDoc });

	it('rejects non-JSON input', () => {
		expect(parseThemeFile('not json')).toEqual({ ok: false, error: 'not_json' });
	});

	it('rejects a wrong format marker', () => {
		expect(
			parseThemeFile(JSON.stringify({ format: 'other', formatVersion: 1, theme: {} }))
		).toEqual({ ok: false, error: 'wrong_format' });
	});

	it('rejects an unsupported format version', () => {
		expect(
			parseThemeFile(JSON.stringify({ format: THEME_FILE_FORMAT, formatVersion: 99, theme: {} }))
		).toEqual({ ok: false, error: 'unsupported_version' });
	});

	it('rejects a missing or empty name', () => {
		expect(parseThemeFile(wrap({ base: 'monokai', tokens: {} }))).toEqual({
			ok: false,
			error: 'missing_name'
		});
	});

	it('rejects an unknown base theme', () => {
		expect(parseThemeFile(wrap({ name: 'X', base: 'nope', tokens: {} }))).toEqual({
			ok: false,
			error: 'unknown_base'
		});
	});

	it('rejects unknown token keys', () => {
		expect(
			parseThemeFile(wrap({ name: 'X', base: 'monokai', tokens: { 'not-a-token': '#fff' } }))
		).toEqual({ ok: false, error: 'invalid_tokens' });
	});

	it('rejects CSS-injection token values', () => {
		const injections = [
			'url(javascript:alert(1))',
			'expression(alert(1))',
			'#fff; } body { display:none',
			'var(--evil)',
			'red; background: url(https://evil.example/x)'
		];
		for (const value of injections) {
			const result = parseThemeFile(
				wrap({ name: 'X', base: 'monokai', tokens: { surface: value } })
			);
			expect(result, value).toEqual({ ok: false, error: 'invalid_tokens' });
		}
	});

	it('rejects a non-http metadata url', () => {
		expect(
			parseThemeFile(wrap({ name: 'X', base: 'monokai', url: 'javascript:alert(1)', tokens: {} }))
		).toEqual({ ok: false, error: 'invalid_metadata' });
	});

	it('rejects oversized files', () => {
		const huge = wrap({
			name: 'X',
			base: 'monokai',
			description: 'x'.repeat(MAX_THEME_FILE_BYTES),
			tokens: {}
		});
		expect(parseThemeFile(huge)).toEqual({ ok: false, error: 'too_large' });
	});

	it('accepts functional color and font-stack values', () => {
		const parsed = parseThemeFile(
			wrap({
				name: 'X',
				base: 'monokai',
				tokens: {
					surface: 'rgb(40, 42, 54)',
					border: 'hsl(230, 15%, 30%)',
					'font-sans': 'ui-monospace, "SF Mono", monospace'
				}
			})
		);
		expect(parsed.ok).toBe(true);
	});
});

describe('isValidCss / isValidThemeCss', () => {
	it('accepts ordinary CSS in both', () => {
		expect(isValidCss('.surface { border-width: 2px }')).toBe(true);
		expect(isValidThemeCss('.surface { border-width: 2px }')).toBe(true);
	});

	it('rejects a `</style>` breakout in both', () => {
		expect(isValidCss('a{}</style><script>x</script>')).toBe(false);
		expect(isValidThemeCss('a{}</STYLE >')).toBe(false);
	});

	it('lets the user call out to a host in their own CSS but not a theme', () => {
		// A theme file arrives from someone else: it must not phone home on every
		// page load. The user's own instance CSS is their business.
		const remote = "@import url('https://evil.example/x.css');";
		expect(isValidCss(remote)).toBe(true);
		expect(isValidThemeCss(remote)).toBe(false);

		const beacon = '.surface { background: url(https://evil.example/pixel.png) }';
		expect(isValidCss(beacon)).toBe(true);
		expect(isValidThemeCss(beacon)).toBe(false);
		expect(isValidThemeCss('.surface { background: url(//evil.example/p.png) }')).toBe(false);
	});

	it('still allows a theme to reference local and inline assets', () => {
		expect(isValidThemeCss(".app-logo { background-image: url('/logo.png') }")).toBe(true);
		expect(isValidThemeCss('.x { background: url(data:image/gif;base64,R0lGOD) }')).toBe(true);
	});
});

describe('parseCustomThemeInput', () => {
	const body = { name: 'Nebula', base: 'catppuccin', tokens: { surface: '#282a36' } };

	it('accepts a theme body without the file envelope', () => {
		const parsed = parseCustomThemeInput(body);
		expect(parsed.ok).toBe(true);
		expect(parsed.ok && parsed.theme.tokens).toEqual({ surface: '#282a36' });
	});

	it('rejects rather than silently dropping a bad token', () => {
		// The editor path used to sanitize: it saved with the offending property
		// quietly missing, so the author's change vanished without a word.
		expect(parseCustomThemeInput({ ...body, tokens: { surface: 'red; x: y' } })).toEqual({
			ok: false,
			error: 'invalid_tokens'
		});
		expect(parseCustomThemeInput({ ...body, tokens: { nonsense: '#fff' } })).toEqual({
			ok: false,
			error: 'invalid_tokens'
		});
	});

	it('rejects a non-object body and an unknown base', () => {
		expect(parseCustomThemeInput(null)).toEqual({ ok: false, error: 'invalid_theme' });
		expect(parseCustomThemeInput([])).toEqual({ ok: false, error: 'invalid_theme' });
		expect(parseCustomThemeInput({ ...body, base: 'nope' })).toEqual({
			ok: false,
			error: 'unknown_base'
		});
	});
});

describe('sanitizeCustomTheme', () => {
	it('is lenient on the way out of storage, dropping only what it cannot read', () => {
		// Strict on the way in, forgiving on the way out: a row written by an older
		// version must not take the whole theme list down with it.
		const clean = sanitizeCustomTheme({
			name: 'Nebula',
			base: 'catppuccin',
			tokens: { surface: '#282a36', bogus: '#fff', radius: 'not-a-length' },
			css: '@import url(https://evil.example/x.css);'
		});
		expect(clean).not.toBeNull();
		expect(clean!.tokens).toEqual({ surface: '#282a36' });
		expect(clean!.css).toBeUndefined();
	});

	it('rejects entries with no usable identity', () => {
		expect(sanitizeCustomTheme({ base: 'catppuccin', tokens: {} })).toBeNull();
		expect(sanitizeCustomTheme({ name: 'X', base: 'nope', tokens: {} })).toBeNull();
	});
});

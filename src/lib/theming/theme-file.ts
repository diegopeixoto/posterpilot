/**
 * Theme-kit engine — theme file format. Serializes custom themes to the
 * shareable `.posterpilot-theme.json` format and validates imports. Validation
 * is the feature: every token key must be known and every value must match a
 * strict per-key grammar, so a malicious file can never inject CSS (no `url()`,
 * expressions, or arbitrary properties — the background image is an override,
 * not a theme token, and is validated separately).
 */

import { findBuiltinTheme } from './presets';
import { TOKEN_KEYS, type CustomTheme, type TokenKey } from './schema';

export const THEME_FILE_FORMAT = 'posterpilot-theme';
export const THEME_FILE_FORMAT_VERSION = 1;

export const MAX_CUSTOM_THEMES = 20;
export const MAX_THEME_FILE_BYTES = 64 * 1024;
/** Cap for the free-form CSS a theme file (or the customCss setting) may carry. */
const MAX_THEME_CSS_BYTES = 16 * 1024;

/** Validate the *user's own* custom CSS: size-capped, no `</style>` breakout.
 *  Anything else is their own business (self-hosted, single-user instance). */
export function isValidCss(value: string): boolean {
	return (
		new TextEncoder().encode(value).byteLength <= MAX_THEME_CSS_BYTES && !/<\/style/i.test(value)
	);
}

/**
 * Validate CSS *shipped inside a theme*. A theme file is a shareable artifact
 * that arrives from someone else, so it gets a stricter grammar than the CSS the
 * user types into their own instance: no `@import` and no remote resources,
 * which would let a downloaded theme call out to a third-party host on every
 * page load. Local `url()` (`/logo.png`, `data:`) still works.
 */
export function isValidThemeCss(value: string): boolean {
	if (!isValidCss(value)) return false;

	// CSS identifiers and URLs may contain escapes. Chromium decodes, for
	// example, `url(\68 ttps://host/pixel)` into a real remote request, so scan a
	// canonical view rather than the source spelling supplied by the theme.
	const canonical = decodeCssEscapes(value.replace(/\/\*[\s\S]*?\*\//g, ''));
	if (/@import\b/i.test(canonical)) return false;
	if (/[a-z][a-z0-9+.-]*:\/\//i.test(canonical)) return false;
	return !/(?:^|[("'=,:])\s*\/\//im.test(canonical);
}

/** Decode the escape forms relevant to CSS tokenization for security checks. */
function decodeCssEscapes(value: string): string {
	return value.replace(
		/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\n\r\f])|([\s\S]))/g,
		(_match, hex: string | undefined, escapedNewline: string | undefined, escaped: string) => {
			if (hex) {
				const codePoint = Number.parseInt(hex, 16);
				if (
					codePoint === 0 ||
					codePoint > 0x10ffff ||
					(codePoint >= 0xd800 && codePoint <= 0xdfff)
				) {
					return '\ufffd';
				}
				return String.fromCodePoint(codePoint);
			}
			if (escapedNewline) return '';
			return escaped ?? '';
		}
	);
}

const META_LIMITS = {
	name: 60,
	author: 200,
	url: 500,
	version: 40,
	description: 500
} as const;

/** Per-token value grammars. Anything outside these is rejected wholesale. */
// Hex is 3, 4, 6 or 8 digits — `{3,8}` also let `#12345` through, which passes
// as "validated" and then fails as a color, unsetting the token (and, for an
// accent, the whole ramp derived from it).
const COLOR_RE =
	/^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const LENGTH_RE = /^(0|\d{1,2}(\.\d{1,3})?(px|rem|em))$/;
const FONT_STACK_RE = /^[\w\s,"'()-]{3,300}$/;

function isValidTokenValue(key: TokenKey, value: string): boolean {
	if (key === 'radius' || key === 'radius-sm') return LENGTH_RE.test(value);
	if (key === 'font-sans') return FONT_STACK_RE.test(value);
	// Everything else is a color token.
	return COLOR_RE.test(value);
}

/** Validate a single color token value (accent/background overrides in the API). */
export function isValidColorValue(value: string): boolean {
	return COLOR_RE.test(value);
}

/** Validate a radius token value (px/rem/em length or 0). */
export function isValidRadiusValue(value: string): boolean {
	return LENGTH_RE.test(value);
}

const TOKEN_KEY_SET = new Set<string>(TOKEN_KEYS);

export type ValidationError =
	| 'not_json'
	| 'invalid_theme'
	| 'wrong_format'
	| 'unsupported_version'
	| 'missing_name'
	| 'unknown_base'
	| 'invalid_tokens'
	| 'invalid_metadata'
	| 'invalid_css'
	| 'too_large';

export interface ThemeFilePayload {
	name: string;
	author?: string;
	url?: string;
	version?: string;
	description?: string;
	base: string;
	tokens: Partial<Record<TokenKey, string>>;
	css?: string;
}

export type ParseThemeFileResult =
	| { ok: true; theme: ThemeFilePayload }
	| { ok: false; error: ValidationError };

/** Serialize a custom theme to the `.posterpilot-theme.json` file format. */
export function serializeThemeFile(theme: CustomTheme): string {
	return JSON.stringify(
		{
			format: THEME_FILE_FORMAT,
			formatVersion: THEME_FILE_FORMAT_VERSION,
			theme: {
				name: theme.name,
				...(theme.author ? { author: theme.author } : {}),
				...(theme.url ? { url: theme.url } : {}),
				...(theme.version ? { version: theme.version } : {}),
				...(theme.description ? { description: theme.description } : {}),
				base: theme.base,
				tokens: theme.tokens,
				...(theme.css ? { css: theme.css } : {})
			}
		},
		null,
		2
	);
}

/** `undefined` = absent, `null` = present but invalid (the caller rejects). */
function cleanMeta(value: unknown, limit: number): string | undefined | null {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') return null;
	// eslint-disable-next-line no-control-regex -- intentionally strips control chars from imported metadata
	const cleaned = value.replace(/[\x00-\x1f]/g, '').trim();
	if (cleaned.length === 0) return undefined;
	if (cleaned.length > limit) return null;
	return cleaned;
}

/**
 * Validate a theme body — the shape shared by an imported file and a theme
 * authored through the API. Rejects wholesale: a single unknown token key or
 * malformed value fails the whole theme rather than being dropped in silence,
 * so the editor can report what is wrong instead of saving a theme with a
 * property quietly missing.
 */
function parseThemePayload(t: Record<string, unknown>): ParseThemeFileResult {
	const name = cleanMeta(t.name, META_LIMITS.name);
	if (!name) return { ok: false, error: 'missing_name' };

	const author = cleanMeta(t.author, META_LIMITS.author);
	const url = cleanMeta(t.url, META_LIMITS.url);
	const version = cleanMeta(t.version, META_LIMITS.version);
	const description = cleanMeta(t.description, META_LIMITS.description);
	if (author === null || url === null || version === null || description === null) {
		return { ok: false, error: 'invalid_metadata' };
	}
	if (url !== undefined && !/^https?:\/\/\S+$/i.test(url)) {
		return { ok: false, error: 'invalid_metadata' };
	}

	if (typeof t.base !== 'string' || !findBuiltinTheme(t.base)) {
		return { ok: false, error: 'unknown_base' };
	}

	if (!t.tokens || typeof t.tokens !== 'object' || Array.isArray(t.tokens)) {
		return { ok: false, error: 'invalid_tokens' };
	}
	const tokens: Partial<Record<TokenKey, string>> = {};
	for (const [key, value] of Object.entries(t.tokens)) {
		if (!TOKEN_KEY_SET.has(key)) return { ok: false, error: 'invalid_tokens' };
		if (typeof value !== 'string' || !isValidTokenValue(key as TokenKey, value)) {
			return { ok: false, error: 'invalid_tokens' };
		}
		tokens[key as TokenKey] = value;
	}

	if (t.css !== undefined && (typeof t.css !== 'string' || !isValidThemeCss(t.css))) {
		return { ok: false, error: 'invalid_css' };
	}

	return {
		ok: true,
		theme: {
			name,
			...(author ? { author } : {}),
			...(url ? { url } : {}),
			...(version ? { version } : {}),
			...(description ? { description } : {}),
			base: t.base,
			tokens,
			...(typeof t.css === 'string' && t.css ? { css: t.css } : {})
		}
	};
}

/** Parse and strictly validate a `.posterpilot-theme.json` file. */
export function parseThemeFile(raw: string | Uint8Array): ParseThemeFileResult {
	const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
	if (new TextEncoder().encode(text).byteLength > MAX_THEME_FILE_BYTES) {
		return { ok: false, error: 'too_large' };
	}

	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return { ok: false, error: 'not_json' };
	}
	if (!doc || typeof doc !== 'object') return { ok: false, error: 'not_json' };

	const file = doc as Record<string, unknown>;
	if (file.format !== THEME_FILE_FORMAT) return { ok: false, error: 'wrong_format' };
	if (file.formatVersion !== THEME_FILE_FORMAT_VERSION) {
		return { ok: false, error: 'unsupported_version' };
	}

	const theme = file.theme;
	if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
		return { ok: false, error: 'not_json' };
	}
	return parseThemePayload(theme as Record<string, unknown>);
}

/** Strictly validate a theme submitted by the authoring UI (same grammar as a
 *  file, without the file envelope). */
export function parseCustomThemeInput(raw: unknown): ParseThemeFileResult {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, error: 'invalid_theme' };
	}
	return parseThemePayload(raw as Record<string, unknown>);
}

/**
 * Lenient validation for themes read back *out of storage*. Strict on the way
 * in (`parseThemeFile` / `parseCustomThemeInput`), forgiving on the way out: a
 * row written by an older version must not take the whole theme list down, so
 * an unreadable property is dropped and the rest survives.
 */
export function sanitizeCustomTheme(raw: unknown): Omit<CustomTheme, 'id'> | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const t = raw as Record<string, unknown>;
	if (typeof t.name !== 'string' || t.name.trim().length === 0) return null;
	if (typeof t.base !== 'string' || !findBuiltinTheme(t.base)) return null;
	const tokens: Partial<Record<TokenKey, string>> = {};
	if (t.tokens && typeof t.tokens === 'object' && !Array.isArray(t.tokens)) {
		for (const [key, value] of Object.entries(t.tokens)) {
			if (!TOKEN_KEY_SET.has(key)) continue;
			if (typeof value !== 'string' || !isValidTokenValue(key as TokenKey, value)) continue;
			tokens[key as TokenKey] = value;
		}
	}
	return {
		name: t.name.trim().slice(0, META_LIMITS.name),
		...(typeof t.author === 'string' && t.author
			? { author: t.author.slice(0, META_LIMITS.author) }
			: {}),
		...(typeof t.url === 'string' && /^https?:\/\/\S+$/i.test(t.url)
			? { url: t.url.slice(0, META_LIMITS.url) }
			: {}),
		...(typeof t.version === 'string' && t.version
			? { version: t.version.slice(0, META_LIMITS.version) }
			: {}),
		...(typeof t.description === 'string' && t.description
			? { description: t.description.slice(0, META_LIMITS.description) }
			: {}),
		base: t.base,
		tokens,
		...(typeof t.css === 'string' && t.css && isValidThemeCss(t.css) ? { css: t.css } : {})
	};
}

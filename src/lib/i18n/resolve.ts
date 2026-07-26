// Pure locale-resolution logic. Intentionally free of `$env`/`$app`/Paraglide
// imports so it loads in the plain-node vitest environment and can be reused on
// both the server and the client.

/** The fixed set of supported UI locales; English is the base/default. */
export const SUPPORTED_LOCALES = ['en', 'es', 'zh', 'ja', 'pt-BR', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** The base (source) locale and last-resort fallback. */
export const BASE_LOCALE: Locale = 'en';

/** Native display names for each supported locale (used by the switcher). */
export const LOCALE_NAMES: Record<Locale, string> = {
	en: 'English',
	es: 'Español',
	zh: '简体中文',
	ja: '日本語',
	'pt-BR': 'Português (BR)',
	fr: 'Français'
};

/** True when `value` names one of the supported locales. */
export function isSupportedLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalize an arbitrary language tag to a supported locale, or `null`.
 *
 * Matching is tolerant of regioned tags and case: an exact match wins (e.g.
 * `pt-BR`), then a base-language match (`pt` → `pt-BR`, `zh-Hans` → `zh`,
 * `en-US` → `en`). Returns `null` for anything outside the supported set.
 */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
	if (!tag) return null;
	const lower = tag.trim().toLowerCase();
	if (!lower) return null;

	// Exact (case-insensitive) match against a supported tag.
	for (const loc of SUPPORTED_LOCALES) {
		if (loc.toLowerCase() === lower) return loc;
	}

	// Base-language match: compare the primary subtag.
	const base = lower.split('-')[0];
	for (const loc of SUPPORTED_LOCALES) {
		if (loc.toLowerCase().split('-')[0] === base) return loc;
	}
	return null;
}

/**
 * Parse an `Accept-Language` header into an ordered list of supported locales,
 * highest q-value first. Unsupported and malformed entries are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale[] {
	if (!header) return [];
	const ranked = header
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.trim().split(';');
			const qParam = params.find((p) => p.trim().startsWith('q='));
			const q = qParam ? Number.parseFloat(qParam.split('=')[1]) : 1;
			return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
		})
		.filter((e) => e.tag && e.tag !== '*')
		.sort((a, b) => b.q - a.q);

	const out: Locale[] = [];
	for (const { tag } of ranked) {
		const loc = normalizeLocale(tag);
		if (loc && !out.includes(loc)) out.push(loc);
	}
	return out;
}

/**
 * Resolve the active UI locale for a request.
 *
 * Precedence: (1) the persisted preferred-language setting when it names a
 * supported locale, (2) the best-matching supported locale from the
 * `Accept-Language` header, (3) the base locale (English). A setting outside
 * the supported set (stale value, env typo) is ignored rather than honored.
 */
export function resolveLocale(
	setting: string | null | undefined,
	acceptLanguage: string | null | undefined
): Locale {
	const fromSetting = normalizeLocale(setting);
	if (fromSetting) return fromSetting;

	const fromHeader = parseAcceptLanguage(acceptLanguage);
	if (fromHeader.length) return fromHeader[0];

	return BASE_LOCALE;
}

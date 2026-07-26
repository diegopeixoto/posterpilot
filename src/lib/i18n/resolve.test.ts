import { describe, it, expect } from 'vitest';
import {
	resolveLocale,
	normalizeLocale,
	parseAcceptLanguage,
	isSupportedLocale,
	SUPPORTED_LOCALES,
	BASE_LOCALE
} from './resolve';

describe('normalizeLocale', () => {
	it('matches a supported tag exactly (case-insensitive)', () => {
		expect(normalizeLocale('en')).toBe('en');
		expect(normalizeLocale('ES')).toBe('es');
		expect(normalizeLocale('pt-BR')).toBe('pt-BR');
		expect(normalizeLocale('pt-br')).toBe('pt-BR');
		expect(normalizeLocale('fr')).toBe('fr');
	});

	it('matches a regioned tag to its base language', () => {
		expect(normalizeLocale('en-US')).toBe('en');
		expect(normalizeLocale('zh-Hans')).toBe('zh');
		expect(normalizeLocale('zh-CN')).toBe('zh');
		expect(normalizeLocale('ja-JP')).toBe('ja');
		expect(normalizeLocale('pt')).toBe('pt-BR');
		expect(normalizeLocale('fr-CA')).toBe('fr');
	});

	it('returns null for unsupported / malformed values', () => {
		expect(normalizeLocale('de')).toBeNull();
		expect(normalizeLocale('de-DE')).toBeNull();
		expect(normalizeLocale('')).toBeNull();
		expect(normalizeLocale('   ')).toBeNull();
		expect(normalizeLocale(null)).toBeNull();
		expect(normalizeLocale(undefined)).toBeNull();
	});
});

describe('isSupportedLocale', () => {
	it('recognizes exactly the supported set', () => {
		for (const loc of SUPPORTED_LOCALES) expect(isSupportedLocale(loc)).toBe(true);
		expect(isSupportedLocale('de')).toBe(false);
		expect(isSupportedLocale('en-US')).toBe(false); // exact tag, not normalized
		expect(isSupportedLocale(42)).toBe(false);
	});
});

describe('parseAcceptLanguage', () => {
	it('returns supported locales ordered by q-value', () => {
		expect(parseAcceptLanguage('es,en;q=0.8,de;q=0.5')).toEqual(['es', 'en']);
		expect(parseAcceptLanguage('fr;q=0.9,ja;q=0.7,de;q=0.5')).toEqual(['fr', 'ja']);
	});

	it('normalizes regioned tags and dedupes', () => {
		expect(parseAcceptLanguage('pt-PT,pt-BR;q=0.9')).toEqual(['pt-BR']);
		expect(parseAcceptLanguage('zh-CN,zh-TW;q=0.9')).toEqual(['zh']);
	});

	it('drops wildcard and unsupported entries; empty when none match', () => {
		expect(parseAcceptLanguage('*')).toEqual([]);
		expect(parseAcceptLanguage('it,de')).toEqual([]);
		expect(parseAcceptLanguage('')).toEqual([]);
		expect(parseAcceptLanguage(null)).toEqual([]);
	});
});

describe('resolveLocale precedence', () => {
	it('setting wins over Accept-Language', () => {
		expect(resolveLocale('ja', 'es,en;q=0.8')).toBe('ja');
		expect(resolveLocale('pt-BR', 'en')).toBe('pt-BR');
	});

	it('falls back to Accept-Language when no setting', () => {
		expect(resolveLocale(null, 'es,en;q=0.8')).toBe('es');
		expect(resolveLocale(undefined, 'zh-CN')).toBe('zh');
		expect(resolveLocale('', 'ja')).toBe('ja');
	});

	it('falls back to English when neither yields a supported locale', () => {
		expect(resolveLocale(null, null)).toBe(BASE_LOCALE);
		expect(resolveLocale(null, 'it,de')).toBe('en');
		expect(resolveLocale(undefined, undefined)).toBe('en');
	});

	it('ignores an unsupported setting and uses the header instead', () => {
		expect(resolveLocale('de', 'es')).toBe('es');
		expect(resolveLocale('klingon', 'it,de')).toBe('en');
	});
});

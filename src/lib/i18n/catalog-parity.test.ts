import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE_LOCALE, SUPPORTED_LOCALES, type Locale } from './resolve';

type Catalog = Record<string, string>;

function loadCatalog(locale: Locale): Catalog {
	return JSON.parse(
		readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8')
	) as Catalog;
}

function parameters(message: string): string[] {
	return [...message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

describe('message catalog parity', () => {
	const source = loadCatalog(BASE_LOCALE);
	const sourceKeys = Object.keys(source).sort();

	it('keeps every supported catalog at the exact English key set', () => {
		for (const locale of SUPPORTED_LOCALES) {
			expect(Object.keys(loadCatalog(locale)).sort(), locale).toEqual(sourceKeys);
		}
	});

	it('keeps translations non-empty and preserves named parameters', () => {
		for (const locale of SUPPORTED_LOCALES) {
			const catalog = loadCatalog(locale);
			for (const key of sourceKeys) {
				expect(catalog[key]?.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
				expect(parameters(catalog[key]), `${locale}:${key}`).toEqual(parameters(source[key]));
			}
		}
	});
});

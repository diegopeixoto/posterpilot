import { describe, expect, it } from 'vitest';
import { normalizeLocale } from '$lib/i18n/resolve';
import {
	artworkLanguageCode,
	classifyCandidateLanguage,
	isArtworkLanguageEligible,
	parseTmdbArtworkLanguage,
	resolveArtworkLanguagePolicy
} from '$lib/tmdb-artwork-language';

describe('artworkLanguageCode', () => {
	it('reduces a regional tag to its ISO 639-1 base', () => {
		expect(artworkLanguageCode('pt-BR')).toBe('pt');
		expect(artworkLanguageCode('en-US')).toBe('en');
		expect(artworkLanguageCode('zh-Hans')).toBe('zh');
	});

	it('trims and lowercases', () => {
		expect(artworkLanguageCode('  EN  ')).toBe('en');
	});

	it('rejects anything that is not a two-letter primary subtag', () => {
		for (const junk of [null, undefined, '', '   ', 'e', 'eng', '1r', 'e2', '-', 'pt_BR']) {
			expect(artworkLanguageCode(junk)).toBeNull();
		}
	});

	it('goes the opposite direction from the UI locale normalizer', () => {
		// normalizeLocale maps toward the supported UI set, so `pt` widens to
		// `pt-BR`. Artwork needs the base code; using normalizeLocale here would
		// send `pt-BR` to TMDB, which tags images with `pt`.
		expect(normalizeLocale('pt')).toBe('pt-BR');
		expect(artworkLanguageCode('pt-BR')).toBe('pt');
	});
});

describe('parseTmdbArtworkLanguage', () => {
	it('accepts the two preference modes', () => {
		expect(parseTmdbArtworkLanguage('any')).toBe('any');
		expect(parseTmdbArtworkLanguage('ui')).toBe('ui');
		expect(parseTmdbArtworkLanguage('  UI ')).toBe('ui');
	});

	it('accepts an explicit language and normalizes it to a base code', () => {
		expect(parseTmdbArtworkLanguage('en')).toBe('en');
		expect(parseTmdbArtworkLanguage('pt-BR')).toBe('pt');
	});

	it('accepts languages beyond the six UI locales', () => {
		expect(parseTmdbArtworkLanguage('de')).toBe('de');
	});

	it('tolerates a trailing separator, taking the primary subtag', () => {
		expect(parseTmdbArtworkLanguage('xx-')).toBe('xx');
	});

	it('returns undefined for absent or invalid values so callers own the fallback', () => {
		for (const junk of [null, undefined, '', '   ', 'english', '42', 'pt_BR']) {
			expect(parseTmdbArtworkLanguage(junk)).toBeUndefined();
		}
	});
});

describe('resolveArtworkLanguagePolicy', () => {
	it('treats an absent or `any` preference as all languages', () => {
		expect(resolveArtworkLanguagePolicy(undefined, 'en')).toEqual({ mode: 'all' });
		expect(resolveArtworkLanguagePolicy('any', 'en')).toEqual({ mode: 'all' });
	});

	it('resolves an explicit language regardless of the UI locale', () => {
		expect(resolveArtworkLanguagePolicy('en', 'pt-BR')).toEqual({
			mode: 'preferred',
			language: 'en'
		});
	});

	it('follows the UI locale in `ui` mode, reduced to a base code', () => {
		expect(resolveArtworkLanguagePolicy('ui', 'pt-BR')).toEqual({
			mode: 'preferred',
			language: 'pt'
		});
	});

	it('degrades to all languages when `ui` has no resolvable locale', () => {
		// An unattended job with no persisted UI language must not invent a
		// restriction.
		expect(resolveArtworkLanguagePolicy('ui', null)).toEqual({ mode: 'all' });
		expect(resolveArtworkLanguagePolicy('ui', 'nonsense')).toEqual({ mode: 'all' });
	});
});

describe('classifyCandidateLanguage', () => {
	const tagged = (language: string) => ({
		provider: 'tmdb',
		language,
		languageProvenance: 'tagged' as const
	});
	const untagged = { provider: 'tmdb', language: null, languageProvenance: 'untagged' as const };
	const legacy = { provider: 'tmdb', language: null, languageProvenance: 'unknown' as const };

	it('accepts everything under an all-languages policy', () => {
		const policy = { mode: 'all' } as const;
		expect(classifyCandidateLanguage(tagged('de'), policy)).toBe('eligible');
		expect(classifyCandidateLanguage(untagged, policy)).toBe('eligible');
		expect(classifyCandidateLanguage(legacy, policy)).toBe('eligible');
	});

	it('accepts the preferred language and explicitly untagged artwork', () => {
		const policy = { mode: 'preferred', language: 'en' } as const;
		expect(classifyCandidateLanguage(tagged('en'), policy)).toBe('eligible');
		expect(classifyCandidateLanguage(untagged, policy)).toBe('eligible');
	});

	it('marks other tagged languages foreign', () => {
		const policy = { mode: 'preferred', language: 'en' } as const;
		expect(classifyCandidateLanguage(tagged('de'), policy)).toBe('foreign');
	});

	it('never assumes legacy candidates are language-neutral', () => {
		// Rows stored before provenance was recorded must trigger refreshed
		// discovery instead of being silently included or excluded.
		const policy = { mode: 'preferred', language: 'en' } as const;
		expect(classifyCandidateLanguage(legacy, policy)).toBe('unknown');
		expect(isArtworkLanguageEligible(legacy, policy)).toBe(false);
	});

	it('compares regional tags on their base code', () => {
		const policy = { mode: 'preferred', language: 'pt' } as const;
		expect(classifyCandidateLanguage(tagged('pt-BR'), policy)).toBe('eligible');
	});

	it('leaves providers that record no provenance untouched', () => {
		// MediUX and ThePosterDB record `unknown` for every candidate they will
		// ever produce. Treating that as ineligible would erase their grids the
		// moment any preference was set, and refreshed discovery could not bring
		// them back because it records `unknown` again.
		const policy = { mode: 'preferred', language: 'en' } as const;
		for (const provider of ['mediux', 'theposterdb']) {
			const candidate = { provider, language: null, languageProvenance: 'unknown' as const };
			expect(classifyCandidateLanguage(candidate, policy)).toBe('eligible');
			expect(isArtworkLanguageEligible(candidate, policy)).toBe(true);
		}
	});

	it('does not filter a provider that tags languages but is not TMDB', () => {
		// Fanart.tv does record tagged provenance, so without this it would be
		// filtered on a signal this setting was never meant to govern.
		const policy = { mode: 'preferred', language: 'en' } as const;
		const fanart = { provider: 'fanarttv', language: 'de', languageProvenance: 'tagged' as const };
		expect(classifyCandidateLanguage(fanart, policy)).toBe('eligible');
	});
});

import { describe, expect, it } from 'vitest';
import {
	ARTWORK_LANGUAGE_CHOICES,
	CANDIDATE_DISCLOSURE_BATCH_SIZE,
	artworkLanguageChoices,
	artworkLanguageName,
	candidateDisclosureKey,
	disclosureState,
	isLanguageFallbackCandidate,
	nextDisclosureLimit,
	summarizeCandidateLanguages,
	visibleArtworkCandidates,
	type LanguageTaggedArtwork
} from './candidate-disclosure';
import type { ArtworkLanguagePolicy } from '$lib/tmdb-artwork-language';

const ALL: ArtworkLanguagePolicy = { mode: 'all' };
const EN: ArtworkLanguagePolicy = { mode: 'preferred', language: 'en' };

function artwork(
	language: string | null,
	languageProvenance: LanguageTaggedArtwork['languageProvenance'],
	id = 0,
	provider = 'tmdb'
): LanguageTaggedArtwork & { id: number } {
	return { provider, language, languageProvenance, id };
}

describe('candidateDisclosureKey', () => {
	it('separates artwork kinds and seasons within one provider set', () => {
		const posters = candidateDisclosureKey('mediux', 'set-1', 'poster');
		expect(posters).toBe('artwork-pane-mediux-set-1-poster-all');
		expect(candidateDisclosureKey('mediux', 'set-1', 'background')).not.toBe(posters);
		expect(candidateDisclosureKey('mediux', 'set-2', 'poster')).not.toBe(posters);
		expect(candidateDisclosureKey('tmdb', 'set-1', 'poster')).not.toBe(posters);
		expect(candidateDisclosureKey('mediux', 'set-1', 'season', 1)).not.toBe(
			candidateDisclosureKey('mediux', 'set-1', 'season', 2)
		);
	});

	it('stays usable as a DOM id for set identifiers that are not', () => {
		expect(candidateDisclosureKey('theposterdb', 'https://a b/c?d=1', 'poster')).toMatch(
			/^[A-Za-z0-9_-]+$/
		);
	});
});

describe('reused disclosure arithmetic', () => {
	it('reveals one batch at a time and stops at the inventory', () => {
		const total = CANDIDATE_DISCLOSURE_BATCH_SIZE + 5;
		const first = disclosureState(CANDIDATE_DISCLOSURE_BATCH_SIZE, total, 12);
		expect(first).toEqual({ shown: CANDIDATE_DISCLOSURE_BATCH_SIZE, remaining: 5, next: 5 });
		const revealed = nextDisclosureLimit(CANDIDATE_DISCLOSURE_BATCH_SIZE, total, 12);
		expect(revealed).toBe(total);
		expect(disclosureState(revealed, total, 12).remaining).toBe(0);
	});
});

describe('visibleArtworkCandidates', () => {
	const candidates = [
		artwork('en', 'tagged', 1),
		artwork('de', 'tagged', 2),
		artwork(null, 'untagged', 3),
		artwork(null, 'unknown', 4)
	];

	it('passes everything through when the policy does not restrict', () => {
		expect(visibleArtworkCandidates(candidates, ALL).map((c) => c.id)).toEqual([1, 2, 3, 4]);
	});

	it('keeps the preferred language and language-neutral artwork only', () => {
		expect(visibleArtworkCandidates(candidates, EN).map((c) => c.id)).toEqual([1, 3]);
	});

	it('keeps a pinned candidate the policy would otherwise hide', () => {
		const visible = visibleArtworkCandidates(candidates, EN, (c) => c.id === 2);
		expect(visible.map((c) => c.id)).toEqual([1, 2, 3]);
	});

	it('never hides a provider the preference does not govern', () => {
		// MediUX and ThePosterDB record `unknown` for everything they produce, and
		// Fanart.tv tags languages this TMDB preference has no say over. Filtering
		// either would empty whole grids that no refresh could restore.
		const others = [
			artwork(null, 'unknown', 10, 'mediux'),
			artwork(null, 'unknown', 11, 'theposterdb'),
			artwork('de', 'tagged', 12, 'fanarttv')
		];
		expect(visibleArtworkCandidates(others, EN).map((c) => c.id)).toEqual([10, 11, 12]);
	});
});

describe('isLanguageFallbackCandidate', () => {
	it('flags foreign and unverified artwork, never eligible artwork', () => {
		expect(isLanguageFallbackCandidate(artwork('de', 'tagged'), EN)).toBe(true);
		expect(isLanguageFallbackCandidate(artwork(null, 'unknown'), EN)).toBe(true);
		expect(isLanguageFallbackCandidate(artwork('en', 'tagged'), EN)).toBe(false);
		expect(isLanguageFallbackCandidate(artwork(null, 'untagged'), EN)).toBe(false);
		expect(isLanguageFallbackCandidate(artwork('de', 'tagged'), ALL)).toBe(false);
	});
});

describe('summarizeCandidateLanguages', () => {
	it('reports nothing to escape when the policy does not restrict', () => {
		expect(summarizeCandidateLanguages([artwork('de', 'tagged')], ALL)).toEqual({
			eligible: 1,
			foreign: 0,
			unknown: 0,
			restricted: false,
			emptyForPreference: false,
			needsRefresh: false
		});
	});

	it('counts each bucket under a restricting policy', () => {
		const summary = summarizeCandidateLanguages(
			[artwork('en', 'tagged'), artwork('de', 'tagged'), artwork(null, 'unknown')],
			EN
		);
		expect(summary.eligible).toBe(1);
		expect(summary.foreign).toBe(1);
		expect(summary.unknown).toBe(1);
		expect(summary.emptyForPreference).toBe(false);
		expect(summary.needsRefresh).toBe(true);
	});

	it('asks for an escape hatch only when the preference hides everything', () => {
		expect(summarizeCandidateLanguages([artwork('de', 'tagged')], EN).emptyForPreference).toBe(
			true
		);
		expect(summarizeCandidateLanguages([], EN).emptyForPreference).toBe(false);
	});

	it('asks for refreshed discovery only for pre-provenance rows', () => {
		expect(summarizeCandidateLanguages([artwork(null, 'untagged')], EN).needsRefresh).toBe(false);
		expect(summarizeCandidateLanguages([artwork(null, 'unknown')], ALL).needsRefresh).toBe(false);
	});
});

describe('artwork language options', () => {
	it('names curated codes natively and falls back to the code itself', () => {
		expect(artworkLanguageName('pt-BR')).toBe('Português');
		expect(artworkLanguageName('nl')).toBe('NL');
		expect(artworkLanguageName(null)).toBe('');
	});

	it('offers the curated list untouched for the preset preferences', () => {
		expect(artworkLanguageChoices('any')).toEqual(ARTWORK_LANGUAGE_CHOICES);
		expect(artworkLanguageChoices('ui')).toEqual(ARTWORK_LANGUAGE_CHOICES);
		expect(artworkLanguageChoices('en')).toEqual(ARTWORK_LANGUAGE_CHOICES);
	});

	it('appends an env-supplied code the curated list does not carry', () => {
		expect(artworkLanguageChoices('nl')).toContain('nl');
		expect(artworkLanguageChoices('nl')).toHaveLength(ARTWORK_LANGUAGE_CHOICES.length + 1);
	});
});

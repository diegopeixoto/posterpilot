import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import {
	buildThePosterDbCollectionArtworkCandidates,
	parseTmdbCollectionArtworkCandidates
} from './native-artwork-candidates';
import {
	assertNativeCollectionArtworkPlan,
	buildNativeCollectionArtworkPlan
} from './native-artwork-plan';

function target() {
	return {
		serverInstanceId: 'server-a',
		mediaCollectionId: 'collection-a',
		nativeSourceId: 'native-77',
		nativeProvider: 'plex' as const,
		linkedTmdbCollectionId: '900',
		entityFingerprint: 'a'.repeat(64),
		serverFingerprint: 'b'.repeat(64),
		candidateSetFingerprint: 'c'.repeat(64)
	};
}

function candidate() {
	return {
		...parseTmdbCollectionArtworkCandidates(
			{ posters: [{ file_path: '/poster.jpg', width: 2000, height: 3000 }] },
			'900',
			DEFAULT_SCORE_WEIGHTS
		)[0],
		contentFingerprint: 'd'.repeat(64),
		contentType: 'image/jpeg'
	};
}

function backgroundCandidate() {
	return {
		...parseTmdbCollectionArtworkCandidates(
			{ backdrops: [{ file_path: '/background.jpg', width: 3840, height: 2160 }] },
			'900',
			DEFAULT_SCORE_WEIGHTS
		)[0],
		contentFingerprint: 'f'.repeat(64),
		contentType: 'image/jpeg'
	};
}

function thePosterDbCandidate() {
	return {
		...buildThePosterDbCollectionArtworkCandidates(
			[
				{
					setId: 'theposterdb-1',
					author: 'creator',
					candidates: [
						{
							setId: 'theposterdb-1',
							setAuthor: 'creator',
							url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/1/a.webp',
							kind: 'poster',
							season: null,
							episode: null
						}
					]
				}
			],
			'900',
			DEFAULT_SCORE_WEIGHTS
		)[0],
		contentFingerprint: 'd'.repeat(64),
		contentType: 'image/jpeg'
	};
}

describe('native collection artwork plan', () => {
	it('freezes exact operations and explicit capability skips', () => {
		const payload = buildNativeCollectionArtworkPlan({
			plannedAt: '2026-07-11T12:00:00.000Z',
			target: target(),
			slots: [
				{
					kind: 'poster',
					capability: 'supported',
					current: { state: 'present', fingerprint: 'e'.repeat(64), artworkVersion: 2 },
					candidate: candidate()
				},
				{
					kind: 'background',
					capability: 'unsupported',
					current: { state: 'absent', fingerprint: null, artworkVersion: 0 },
					candidate: backgroundCandidate()
				}
			]
		});

		expect(payload.summary).toEqual({
			operationCount: 1,
			skipCount: 1,
			poster: 'planned',
			background: 'collection_slot_unsupported'
		});
		expect(payload.operations[0].candidate.url).toContain('image.tmdb.org');
		expect(() => assertNativeCollectionArtworkPlan(payload)).not.toThrow();
	});

	it('rejects a tampered source fingerprint and cross-scope target', () => {
		const payload = buildNativeCollectionArtworkPlan({
			plannedAt: '2026-07-11T12:00:00.000Z',
			target: target(),
			slots: [
				{
					kind: 'poster',
					capability: 'supported',
					current: { state: 'absent', fingerprint: null, artworkVersion: 0 },
					candidate: candidate()
				}
			]
		});
		expect(() =>
			assertNativeCollectionArtworkPlan({
				...payload,
				target: { ...payload.target, serverInstanceId: '../server-b' }
			})
		).toThrow('invalid_native_collection_plan');
		expect(() =>
			assertNativeCollectionArtworkPlan({ ...payload, sourceFingerprint: 'f'.repeat(64) })
		).toThrow('invalid_native_collection_plan');
	});

	it('accepts a ThePosterDB poster candidate on its own asset host', () => {
		const payload = buildNativeCollectionArtworkPlan({
			plannedAt: '2026-07-11T12:00:00.000Z',
			target: target(),
			slots: [
				{
					kind: 'poster',
					capability: 'supported',
					current: { state: 'absent', fingerprint: null, artworkVersion: 0 },
					candidate: thePosterDbCandidate()
				}
			]
		});
		expect(payload.operations[0].candidate.provider).toBe('theposterdb');
		expect(payload.operations[0].candidate.url).toContain('images.theposterdb.com');
		expect(() => assertNativeCollectionArtworkPlan(payload)).not.toThrow();
	});

	it('rejects a candidate whose url does not match its own provider host allowlist', () => {
		const payload = buildNativeCollectionArtworkPlan({
			plannedAt: '2026-07-11T12:00:00.000Z',
			target: target(),
			slots: [
				{
					kind: 'poster',
					capability: 'supported',
					current: { state: 'absent', fingerprint: null, artworkVersion: 0 },
					candidate: { ...thePosterDbCandidate(), url: 'https://evil.example.com/a.webp' }
				}
			]
		});
		expect(() => assertNativeCollectionArtworkPlan(payload)).toThrow(
			'invalid_native_collection_plan'
		);
	});
});

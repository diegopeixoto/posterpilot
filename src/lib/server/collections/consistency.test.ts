import { describe, expect, it } from 'vitest';
import {
	calculateCollectionConsistency,
	collectionArtworkFamilyKey,
	type CollectionArtworkFamily
} from './consistency';

const family = (
	designFamily: string | null,
	setId: string | null = null
): CollectionArtworkFamily => ({
	provider: 'mediux',
	designFamily,
	setId,
	language: 'en',
	setAuthor: 'curator'
});

describe('collection consistency coverage', () => {
	it('uses the dominant evidenced family and distinguishes a staged mismatch', () => {
		const result = calculateCollectionConsistency([
			{ id: 1, hasArtwork: true, evidence: family('minimal'), evidenceSource: 'current' },
			{ id: 2, hasArtwork: true, evidence: family('minimal'), evidenceSource: 'staged' },
			{ id: 3, hasArtwork: true, evidence: family('illustrated'), evidenceSource: 'staged' }
		]);

		expect(result).toMatchObject({
			status: 'mixed',
			localMembers: 3,
			coveredMembers: 2,
			knownEvidence: 3,
			mismatchedMembers: 1,
			percentage: 67,
			dominantFamily: family('minimal')
		});
		expect(result.members).toEqual([
			{ id: 1, state: 'matches' },
			{ id: 2, state: 'matches' },
			{ id: 3, state: 'staged_mismatch' }
		]);
	});

	it('keeps missing artwork separate from unknown provenance', () => {
		const result = calculateCollectionConsistency([
			{ id: 1, hasArtwork: true, evidence: family('minimal'), evidenceSource: 'current' },
			{ id: 2, hasArtwork: true, evidence: null, evidenceSource: null },
			{ id: 3, hasArtwork: false, evidence: null, evidenceSource: null }
		]);

		expect(result).toMatchObject({
			status: 'incomplete',
			coveredMembers: 1,
			missingArtwork: 1,
			unknownProvenance: 1,
			mismatchedMembers: 0,
			percentage: 33
		});
		expect(result.members).toContainEqual({ id: 2, state: 'unknown_provenance' });
		expect(result.members).toContainEqual({ id: 3, state: 'missing_artwork' });
	});

	it('does not infer a family from provider or author alone', () => {
		expect(collectionArtworkFamilyKey(family(null, null))).toBeNull();
		const result = calculateCollectionConsistency([
			{ id: 1, hasArtwork: true, evidence: family(null, null), evidenceSource: 'current' }
		]);
		expect(result).toMatchObject({ status: 'unknown', knownEvidence: 0, percentage: 0 });
	});
});

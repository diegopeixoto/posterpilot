export type CollectionArtworkKind = 'poster' | 'background';

export interface CollectionArtworkFamily {
	provider: string;
	setId: string | null;
	designFamily: string | null;
	language: string | null;
	setAuthor: string | null;
}

export interface CollectionConsistencyMemberInput {
	id: number;
	hasArtwork: boolean;
	evidence: CollectionArtworkFamily | null;
	evidenceSource: 'current' | 'staged' | null;
}

export type CollectionConsistencyMemberState =
	| 'matches'
	| 'reviewed_mismatch'
	| 'staged_mismatch'
	| 'unknown_provenance'
	| 'missing_artwork';

export interface CollectionConsistencyMemberResult {
	id: number;
	state: CollectionConsistencyMemberState;
}

export interface CollectionConsistencyCoverage {
	status: 'consistent' | 'mixed' | 'incomplete' | 'unknown';
	localMembers: number;
	coveredMembers: number;
	knownEvidence: number;
	missingArtwork: number;
	unknownProvenance: number;
	mismatchedMembers: number;
	percentage: number;
	dominantFamily: CollectionArtworkFamily | null;
	members: CollectionConsistencyMemberResult[];
}

function normalized(value: string | null): string | null {
	const text = value?.trim();
	return text || null;
}

/**
 * A family key must be backed by a provider plus explicit design-family or set
 * metadata. Author alone is intentionally insufficient: suggestion grouping and
 * author-based fallbacks belong to the coordinated-suggestion workflow.
 */
export function collectionArtworkFamilyKey(family: CollectionArtworkFamily | null): string | null {
	if (!family) return null;
	const provider = normalized(family.provider);
	const designFamily = normalized(family.designFamily);
	const setId = normalized(family.setId);
	if (!provider || (!designFamily && !setId)) return null;
	const identity = designFamily ? `family:${designFamily}` : `set:${setId}`;
	return JSON.stringify([provider, identity, normalized(family.language)]);
}

/**
 * Explain current collection consistency without guessing provenance. Staged
 * evidence takes precedence upstream; unavailable members never enter this
 * function and therefore never inflate or reduce completion coverage.
 */
export function calculateCollectionConsistency(
	members: CollectionConsistencyMemberInput[]
): CollectionConsistencyCoverage {
	const evidence = new Map<
		string,
		{ family: CollectionArtworkFamily; count: number; firstIndex: number }
	>();

	for (const [index, member] of members.entries()) {
		if (!member.hasArtwork) continue;
		const key = collectionArtworkFamilyKey(member.evidence);
		if (!key || !member.evidence) continue;
		const prior = evidence.get(key);
		if (prior) prior.count += 1;
		else evidence.set(key, { family: member.evidence, count: 1, firstIndex: index });
	}

	const dominantEntry = [...evidence.entries()].sort(
		([leftKey, left], [rightKey, right]) =>
			right.count - left.count ||
			left.firstIndex - right.firstIndex ||
			leftKey.localeCompare(rightKey)
	)[0];
	const dominantKey = dominantEntry?.[0] ?? null;
	const dominantFamily = dominantEntry?.[1].family ?? null;

	let coveredMembers = 0;
	let knownEvidence = 0;
	let missingArtwork = 0;
	let unknownProvenance = 0;
	let mismatchedMembers = 0;
	const results: CollectionConsistencyMemberResult[] = [];

	for (const member of members) {
		if (!member.hasArtwork) {
			missingArtwork += 1;
			results.push({ id: member.id, state: 'missing_artwork' });
			continue;
		}
		const key = collectionArtworkFamilyKey(member.evidence);
		if (!key || !dominantKey) {
			unknownProvenance += 1;
			results.push({ id: member.id, state: 'unknown_provenance' });
			continue;
		}
		knownEvidence += 1;
		if (key === dominantKey) {
			coveredMembers += 1;
			results.push({ id: member.id, state: 'matches' });
			continue;
		}
		mismatchedMembers += 1;
		results.push({
			id: member.id,
			state: member.evidenceSource === 'staged' ? 'staged_mismatch' : 'reviewed_mismatch'
		});
	}

	const localMembers = members.length;
	const percentage = localMembers === 0 ? 0 : Math.round((coveredMembers / localMembers) * 100);
	const status =
		localMembers === 0 || knownEvidence === 0
			? 'unknown'
			: mismatchedMembers > 0
				? 'mixed'
				: coveredMembers === localMembers
					? 'consistent'
					: 'incomplete';

	return {
		status,
		localMembers,
		coveredMembers,
		knownEvidence,
		missingArtwork,
		unknownProvenance,
		mismatchedMembers,
		percentage,
		dominantFamily,
		members: results
	};
}

import type { PosterCandidate } from '$lib/server/db/schema';

/** A MediaUX set: artwork uploaded together, with the uploader's attribution. */
export interface CandidateSet {
	setId: string;
	author: string | null;
	candidates: PosterCandidate[];
}

/**
 * Group candidates by set id, preserving first-seen order (candidates are stored
 * newest-set-first at discovery time). Pure — kept free of DB imports so it can be
 * unit-tested in isolation.
 */
export function groupCandidatesBySet(candidates: PosterCandidate[]): CandidateSet[] {
	const bySet = new Map<string, CandidateSet>();
	const order: string[] = [];
	for (const c of candidates) {
		let set = bySet.get(c.setId);
		if (!set) {
			set = { setId: c.setId, author: c.setAuthor, candidates: [] };
			bySet.set(c.setId, set);
			order.push(c.setId);
		}
		set.candidates.push(c);
	}
	return order.map((id) => bySet.get(id)!);
}

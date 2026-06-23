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

/** Candidates from one provider, grouped into that provider's sets. */
export interface ProviderGroup {
	provider: string;
	sets: CandidateSet[];
}

/**
 * Group candidates first by provider (first-seen order) and then by set within each
 * provider. Two providers may emit the same setId without colliding because they are
 * kept in separate groups. Pure — no DB imports.
 */
export function groupByProvider(candidates: PosterCandidate[]): ProviderGroup[] {
	const byProvider = new Map<string, PosterCandidate[]>();
	const order: string[] = [];
	for (const c of candidates) {
		if (!byProvider.has(c.provider)) {
			byProvider.set(c.provider, []);
			order.push(c.provider);
		}
		byProvider.get(c.provider)!.push(c);
	}
	return order.map((provider) => ({
		provider,
		sets: groupCandidatesBySet(byProvider.get(provider)!)
	}));
}

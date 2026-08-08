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
 * Group candidates first by provider and then by set within each provider. Two
 * providers may emit the same setId without colliding because they are kept in
 * separate groups. Pure — no DB imports.
 *
 * Provider order comes from `providerPriority` and from nothing else. Discovery runs
 * providers in parallel and each commits its own transaction, so candidate row ids —
 * and therefore the first-seen provider order this used to follow — record only which
 * provider answered first, which is exactly the accident the review page must not
 * present as an ordering.
 *
 * `providerPriority` is required rather than defaulted to `DEFAULT_PROVIDER_PRIORITY`:
 * a caller that forgot it would still render a deterministic-looking page that silently
 * ignores the user's configured order, and nothing in the output would reveal it. Making
 * omission a type error costs the one production caller a single argument.
 *
 * This is presentation only. Candidate order inside a group is untouched, and scoring
 * applies the same priority strictly as a tie-break after the numeric score (see
 * `selectAutomaticArtwork`), so a better-scoring candidate still wins regardless of
 * where its provider's card sits.
 */
export function groupByProvider(
	candidates: PosterCandidate[],
	providerPriority: readonly string[]
): ProviderGroup[] {
	const byProvider = new Map<string, PosterCandidate[]>();
	const firstSeen: string[] = [];
	for (const c of candidates) {
		let group = byProvider.get(c.provider);
		if (!group) {
			group = [];
			byProvider.set(c.provider, group);
			firstSeen.push(c.provider);
		}
		group.push(c);
	}

	// A Set both de-duplicates a malformed priority list (which would otherwise emit the
	// same provider's card twice) and gives the unknown-provider lookup below O(1).
	const configured = new Set(providerPriority);
	// Configured providers that produced nothing simply have no map entry and drop out
	// without shifting the ones around them.
	const order = [...configured].filter((provider) => byProvider.has(provider));
	// Providers the configured order does not mention — a newly added source, or a row
	// left behind by a removed one — go last in first-seen order. Sorting them
	// alphabetically instead would let one new provider id reshuffle the others.
	for (const provider of firstSeen) {
		if (!configured.has(provider)) order.push(provider);
	}

	return order.map((provider) => ({
		provider,
		sets: groupProviderCandidates(provider, byProvider.get(provider)!)
	}));
}

/**
 * ThePosterDB's real per-set/per-author setId (see providers/parse.ts) matters for
 * cross-title matching: collections/suggestions.ts groups a franchise-spanning creator
 * set across members by that real setId. On a single item's review page, though, each of
 * those "sets" is almost always exactly one poster, so splitting them into a dozen
 * single-poster "by <author>" cards adds clicks without adding useful signal — show them
 * as one flat, unattributed list here instead, same as before ThePosterDB had real setIds.
 * Every other provider keeps the normal per-setId grouping.
 */
function groupProviderCandidates(provider: string, candidates: PosterCandidate[]): CandidateSet[] {
	if (provider === 'theposterdb') {
		return [{ setId: 'theposterdb', author: null, candidates }];
	}
	return groupCandidatesBySet(candidates);
}

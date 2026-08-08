import { describe, expect, it } from 'vitest';
import { groupByProvider, groupCandidatesBySet } from './sets';
import type { PosterCandidate } from '$lib/server/db/schema';

function cand(p: Partial<PosterCandidate>): PosterCandidate {
	return {
		id: 0,
		serverInstanceId: 'server-test',
		mediaItemId: 1,
		discoveryRunId: null,
		providerOutcomeId: null,
		setId: 's1',
		provider: 'mediux',
		providerAssetId: null,
		setAuthor: null,
		designFamily: null,
		language: null,
		languageProvenance: 'unknown',
		url: 'u',
		previewUrl: null,
		kind: 'poster',
		season: null,
		episode: null,
		width: null,
		height: null,
		score: null,
		resolvedTmdbId: null,
		resolvedMediaType: null,
		active: true,
		stale: false,
		lastSeenAt: null,
		createdAt: new Date(0),
		...p
	};
}

describe('groupCandidatesBySet', () => {
	it('groups candidates by set id, preserving first-seen order', () => {
		const sets = groupCandidatesBySet([
			cand({ setId: 'a', kind: 'poster', url: 'a1' }),
			cand({ setId: 'a', kind: 'background', url: 'a2' }),
			cand({ setId: 'b', kind: 'poster', url: 'b1' })
		]);
		expect(sets.map((s) => s.setId)).toEqual(['a', 'b']);
		expect(sets[0].candidates.map((c) => c.url)).toEqual(['a1', 'a2']);
		expect(sets[1].candidates).toHaveLength(1);
	});

	it('carries the set author onto the group', () => {
		const sets = groupCandidatesBySet([cand({ setId: 'a', setAuthor: 'alice' })]);
		expect(sets[0].author).toBe('alice');
	});

	it('returns an empty list for no candidates', () => {
		expect(groupCandidatesBySet([])).toEqual([]);
	});
});

describe('groupByProvider', () => {
	const priority = ['mediux', 'theposterdb', 'fanarttv', 'tmdb'];

	it('groups by provider (configured order) then by set', () => {
		const groups = groupByProvider(
			[
				cand({ provider: 'mediux', setId: 'a', url: 'm1' }),
				cand({ provider: 'tmdb', setId: 'tmdb', url: 't1' }),
				cand({ provider: 'mediux', setId: 'a', url: 'm2' })
			],
			priority
		);
		expect(groups.map((g) => g.provider)).toEqual(['mediux', 'tmdb']);
		expect(groups[0].sets[0].candidates.map((c) => c.url)).toEqual(['m1', 'm2']);
		expect(groups[1].sets[0].setId).toBe('tmdb');
	});

	it('follows the configured order even when the lower-priority provider finished first', () => {
		// Discovery runs providers in parallel, so candidate rows come back in whichever
		// order the transactions committed. Feeding them in exactly reverse priority is the
		// regression case: the old first-seen grouping returned this list unchanged.
		const groups = groupByProvider(
			[
				cand({ provider: 'tmdb', setId: 'tmdb' }),
				cand({ provider: 'fanarttv', setId: 'fanarttv' }),
				cand({ provider: 'theposterdb', setId: 'theposterdb-1' }),
				cand({ provider: 'mediux', setId: 'a' })
			],
			priority
		);
		expect(groups.map((g) => g.provider)).toEqual(priority);
	});

	it('honours a reordered priority rather than any intrinsic provider ranking', () => {
		const groups = groupByProvider(
			[cand({ provider: 'mediux', setId: 'a' }), cand({ provider: 'tmdb', setId: 'tmdb' })],
			['tmdb', 'fanarttv', 'theposterdb', 'mediux']
		);
		expect(groups.map((g) => g.provider)).toEqual(['tmdb', 'mediux']);
	});

	it('omits a configured provider with no candidates without disturbing the rest', () => {
		// theposterdb and fanarttv sit between mediux and tmdb in the configured order; a
		// run where neither returned anything must not pull tmdb ahead of mediux.
		const groups = groupByProvider(
			[cand({ provider: 'tmdb', setId: 'tmdb' }), cand({ provider: 'mediux', setId: 'a' })],
			priority
		);
		expect(groups.map((g) => g.provider)).toEqual(['mediux', 'tmdb']);
	});

	it('sorts providers missing from the configured order last, in first-seen order', () => {
		// Rows can outlive a provider's presence in settings (a source added ahead of the
		// stored priority, or removed from it). They still belong on the page, just behind
		// everything the user actually ranked — and behind each other in a stable order,
		// which alphabetical sorting would not give.
		const groups = groupByProvider(
			[
				cand({ provider: 'zeta', setId: 'z' }),
				cand({ provider: 'tmdb', setId: 'tmdb' }),
				cand({ provider: 'alpha', setId: 'al' }),
				cand({ provider: 'mediux', setId: 'a' })
			],
			priority
		);
		expect(groups.map((g) => g.provider)).toEqual(['mediux', 'tmdb', 'zeta', 'alpha']);
	});

	it('leaves candidate order within a group untouched', () => {
		// Provider order is presentation only — the candidates inside a card keep the
		// discovery order the scorer and the UI already agree on.
		const groups = groupByProvider(
			[
				cand({ provider: 'tmdb', setId: 'tmdb', url: 't1' }),
				cand({ provider: 'mediux', setId: 'a', url: 'm1' }),
				cand({ provider: 'tmdb', setId: 'tmdb', url: 't2' }),
				cand({ provider: 'mediux', setId: 'b', url: 'm2' }),
				cand({ provider: 'mediux', setId: 'a', url: 'm3' })
			],
			priority
		);
		expect(groups.map((g) => g.provider)).toEqual(['mediux', 'tmdb']);
		expect(groups[0].sets.map((s) => s.setId)).toEqual(['a', 'b']);
		expect(groups[0].sets[0].candidates.map((c) => c.url)).toEqual(['m1', 'm3']);
		expect(groups[1].sets[0].candidates.map((c) => c.url)).toEqual(['t1', 't2']);
	});

	it('emits one group per provider even when the priority list repeats one', () => {
		const groups = groupByProvider(
			[cand({ provider: 'mediux', setId: 'a' })],
			['mediux', 'tmdb', 'mediux']
		);
		expect(groups.map((g) => g.provider)).toEqual(['mediux']);
	});

	it('keeps same setId from different providers separate', () => {
		const groups = groupByProvider(
			[cand({ provider: 'mediux', setId: 'x' }), cand({ provider: 'tmdb', setId: 'x' })],
			priority
		);
		expect(groups).toHaveLength(2);
	});

	it('returns an empty list for no candidates', () => {
		expect(groupByProvider([], priority)).toEqual([]);
	});

	it('flattens theposterdb into one unattributed set instead of one per creator set', () => {
		// Each ThePosterDB "set" is real (see providers/parse.ts) and matters for
		// collection-level family matching, but on a single item's review page it's almost
		// always exactly one poster per set — grouping by setId here would mean one card per
		// contributor for what the user experiences as one flat list of poster options.
		const groups = groupByProvider(
			[
				cand({
					provider: 'theposterdb',
					setId: 'theposterdb-13035',
					setAuthor: 'MBF',
					url: 'p1'
				}),
				cand({
					provider: 'theposterdb',
					setId: 'theposterdb-254',
					setAuthor: 'cinemoire',
					url: 'p2'
				}),
				cand({ provider: 'mediux', setId: 'a', setAuthor: 'someone', url: 'm1' })
			],
			priority
		);
		const tpdb = groups.find((g) => g.provider === 'theposterdb')!;
		expect(tpdb.sets).toHaveLength(1);
		expect(tpdb.sets[0].author).toBeNull();
		expect(tpdb.sets[0].candidates.map((c) => c.url)).toEqual(['p1', 'p2']);
		// Other providers are unaffected — still grouped normally by their own setId.
		const mediux = groups.find((g) => g.provider === 'mediux')!;
		expect(mediux.sets).toHaveLength(1);
		expect(mediux.sets[0].author).toBe('someone');
	});
});

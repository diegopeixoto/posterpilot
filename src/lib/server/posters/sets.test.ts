import { describe, expect, it } from 'vitest';
import { groupCandidatesBySet } from './sets';
import type { PosterCandidate } from '$lib/server/db/schema';

function cand(p: Partial<PosterCandidate>): PosterCandidate {
	return {
		id: 0,
		mediaItemId: 1,
		setId: 's1',
		setAuthor: null,
		url: 'u',
		kind: 'poster',
		season: null,
		episode: null,
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

import { describe, expect, it } from 'vitest';
import {
	choosePosterMatchWinner,
	createPosterMatch,
	markPosterMatchUnavailable
} from './fun-poster-match';

const candidates = [1, 2, 3, 4, 5].map((id) => ({ id, url: `https://example.test/${id}.jpg` }));

describe('poster match bracket', () => {
	it('deduplicates ids and URLs before building a finite bracket', () => {
		const state = createPosterMatch(
			[
				...candidates,
				{ id: 1, url: 'https://example.test/duplicate-id.jpg' },
				{ id: 8, url: candidates[0].url }
			],
			'bracket'
		);
		expect(state.totalMatches).toBe(4);
		expect(new Set(state.remaining).size).toBe(state.remaining.length);
	});

	it('finishes after n-1 choices with one winner', () => {
		let state = createPosterMatch(candidates, 'finite');
		let choices = 0;
		while (state.current) {
			state = choosePosterMatchWinner(state, state.current[0]);
			choices += 1;
		}
		expect(choices).toBe(candidates.length - 1);
		expect(state.completedMatches).toBe(state.totalMatches);
		expect(state.winnerId).not.toBeNull();
	});

	it('ignores a winner that is not in the visible match', () => {
		const state = createPosterMatch(candidates, 'guard');
		expect(choosePosterMatchWinner(state, 999)).toEqual(state);
	});

	it('automatically advances the opponent of an unavailable image', () => {
		const state = createPosterMatch(candidates.slice(0, 2), 'broken');
		const broken = state.current![0];
		const opponent = state.current![1];
		const next = markPosterMatchUnavailable(state, broken);
		expect(next.winnerId).toBe(opponent);
		expect(next.unavailableIds).toContain(broken);
	});

	it('can finish without a winner if every candidate becomes unavailable', () => {
		let state = createPosterMatch(candidates.slice(0, 2), 'all-broken');
		const first = state.current![0];
		const second = state.current![1];
		state = markPosterMatchUnavailable(state, first);
		state = markPosterMatchUnavailable(state, second);
		expect(state.winnerId).toBeNull();
		expect(state.unavailableIds).toEqual(expect.arrayContaining([first, second]));
	});
});

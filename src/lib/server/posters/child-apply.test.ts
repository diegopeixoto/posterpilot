import { describe, expect, it } from 'vitest';
import { resolveChildOps, seasonsNeedingEpisodes, type StagedChildSlot } from './child-apply';
import type { ServerChild } from '$lib/server/media-server/types';

const seasons: ServerChild[] = [
	{ id: 's1', number: 1 },
	{ id: 's2', number: 2 }
];
const episodesBySeason: Record<number, ServerChild[]> = {
	1: [
		{ id: 's1e1', number: 1 },
		{ id: 's1e2', number: 2 }
	],
	2: [{ id: 's2e1', number: 1 }]
};

describe('seasonsNeedingEpisodes', () => {
	it('returns unique seasons that have title-card slots', () => {
		const slots: StagedChildSlot[] = [
			{ kind: 'poster', season: 1, episode: null, url: 'a' },
			{ kind: 'title_card', season: 1, episode: 1, url: 'b' },
			{ kind: 'title_card', season: 1, episode: 2, url: 'c' },
			{ kind: 'title_card', season: 2, episode: 1, url: 'd' }
		];
		expect(seasonsNeedingEpisodes(slots).sort()).toEqual([1, 2]);
	});

	it('returns empty when no episode slots are staged', () => {
		expect(
			seasonsNeedingEpisodes([{ kind: 'background', season: 1, episode: null, url: 'a' }])
		).toEqual([]);
	});
});

describe('resolveChildOps', () => {
	it('maps a season poster to its season child poster field', () => {
		const { ops, skipped } = resolveChildOps(
			[{ kind: 'poster', season: 2, episode: null, url: 'p' }],
			seasons,
			{}
		);
		expect(skipped).toEqual([]);
		expect(ops).toEqual([
			{
				childId: 's2',
				field: 'poster',
				url: 'p',
				slot: { kind: 'poster', season: 2, episode: null, url: 'p' }
			}
		]);
	});

	it('maps a season background to the background field', () => {
		const { ops } = resolveChildOps(
			[{ kind: 'background', season: 1, episode: null, url: 'bg' }],
			seasons,
			{}
		);
		expect(ops[0].field).toBe('background');
		expect(ops[0].childId).toBe('s1');
	});

	it('maps an episode title card to its episode child poster field', () => {
		const { ops, skipped } = resolveChildOps(
			[{ kind: 'title_card', season: 1, episode: 2, url: 'tc' }],
			seasons,
			episodesBySeason
		);
		expect(skipped).toEqual([]);
		expect(ops[0]).toMatchObject({ childId: 's1e2', field: 'poster', url: 'tc' });
	});

	it('skips a slot whose season has no matching child', () => {
		const { ops, skipped } = resolveChildOps(
			[{ kind: 'poster', season: 9, episode: null, url: 'x' }],
			seasons,
			{}
		);
		expect(ops).toEqual([]);
		expect(skipped).toEqual([
			{ slot: { kind: 'poster', season: 9, episode: null, url: 'x' }, reason: 'season-not-found' }
		]);
	});

	it('skips a title card whose episode has no matching child', () => {
		const { ops, skipped } = resolveChildOps(
			[{ kind: 'title_card', season: 1, episode: 99, url: 'x' }],
			seasons,
			episodesBySeason
		);
		expect(ops).toEqual([]);
		expect(skipped[0].reason).toBe('episode-not-found');
	});
});

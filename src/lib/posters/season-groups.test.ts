import { describe, expect, it } from 'vitest';
import { groupSetArtwork, type ArtworkLike } from './season-groups';

type C = ArtworkLike & { id: number };

const make = (
	id: number,
	kind: C['kind'],
	season: number | null = null,
	episode: number | null = null
): C => ({
	id,
	kind,
	season,
	episode
});

describe('groupSetArtwork', () => {
	it('splits show posters/backgrounds from season groups', () => {
		const { posters, backgrounds, seasons } = groupSetArtwork([
			make(1, 'poster'),
			make(2, 'background'),
			make(3, 'season', 1),
			make(4, 'title_card', 1, 2),
			make(5, 'title_card', 1, 1)
		]);
		expect(posters.map((c) => c.id)).toEqual([1]);
		expect(backgrounds.map((c) => c.id)).toEqual([2]);
		expect(seasons).toHaveLength(1);
		expect(seasons[0].season).toBe(1);
		expect(seasons[0].posters.map((c) => c.id)).toEqual([3]);
		// title cards sorted by episode number
		expect(seasons[0].titleCards.map((c) => c.id)).toEqual([5, 4]);
	});

	it('orders season groups by season number', () => {
		const { seasons } = groupSetArtwork([
			make(1, 'season', 3),
			make(2, 'season', 1),
			make(3, 'season', 2)
		]);
		expect(seasons.map((g) => g.season)).toEqual([1, 2, 3]);
	});

	it('drops season/title-card candidates lacking required numbers', () => {
		const { seasons } = groupSetArtwork([
			make(1, 'season', null),
			make(2, 'title_card', 1, null),
			make(3, 'title_card', null, 1)
		]);
		expect(seasons).toEqual([]);
	});
});

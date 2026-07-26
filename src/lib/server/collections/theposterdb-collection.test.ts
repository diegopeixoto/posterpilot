import { describe, expect, it } from 'vitest';
import { matchThePosterDbSetToMembers } from './theposterdb-collection-match';
import type { ThePosterDbSetPoster } from '$lib/server/posters/providers/parse';

const poster = (p: Partial<ThePosterDbSetPoster> & Pick<ThePosterDbSetPoster, 'title'>) =>
	({
		posterId: '1',
		type: 'movie',
		url: `https://images.theposterdb.com/${p.title}.webp`,
		year: null,
		setId: '324469',
		...p
	}) satisfies ThePosterDbSetPoster;

describe('matchThePosterDbSetToMembers', () => {
	it('maps movie posters onto members by title and returns the collection poster apart', () => {
		const posters: ThePosterDbSetPoster[] = [
			poster({ posterId: '487329', title: 'Cash Out', year: 2024 }),
			poster({ posterId: '583343', type: 'collection', title: 'Cash Out - Saga' }),
			poster({ posterId: '583344', title: 'High Rollers', year: 2025 }),
			poster({ posterId: '728477', title: 'The Gentleman Thief', year: 2026 })
		];
		const members = [
			{ mediaItemId: 10, title: 'Cash Out', year: 2024 },
			{ mediaItemId: 11, title: 'High Rollers', year: 2025 }
			// Gentleman Thief not in library
		];

		const result = matchThePosterDbSetToMembers(posters, members);
		expect(result.collectionPosterUrl).toContain('Cash Out - Saga');
		expect(result.matches).toEqual([
			{ mediaItemId: 10, posterId: '487329', url: 'https://images.theposterdb.com/Cash Out.webp' },
			{
				mediaItemId: 11,
				posterId: '583344',
				url: 'https://images.theposterdb.com/High Rollers.webp'
			}
		]);
	});

	it('matches when the Jellyfin title contains extra words (token subset)', () => {
		const posters = [
			poster({ posterId: '487329', title: 'Cash Out', year: 2024 }),
			poster({ posterId: '583344', title: 'High Rollers', year: 2025 })
		];
		// Jellyfin names the sequel "Cash Out 2: High Rollers" — exact title fails, subset wins,
		// and the exact "Cash Out" match must claim the first member so subset can't steal it.
		const members = [
			{ mediaItemId: 68, title: 'Cash Out', year: 2024 },
			{ mediaItemId: 220, title: 'Cash Out 2: High Rollers', year: 2025 }
		];
		expect(matchThePosterDbSetToMembers(posters, members).matches).toEqual([
			{ mediaItemId: 68, posterId: '487329', url: 'https://images.theposterdb.com/Cash Out.webp' },
			{
				mediaItemId: 220,
				posterId: '583344',
				url: 'https://images.theposterdb.com/High Rollers.webp'
			}
		]);
	});

	it('falls back to equal year when titles do not overlap', () => {
		const posters = [poster({ posterId: 'x', title: 'The Gentleman Thief', year: 2026 })];
		const members = [{ mediaItemId: 9, title: 'Cash Out 3', year: 2026 }];
		expect(matchThePosterDbSetToMembers(posters, members).matches).toEqual([
			{
				mediaItemId: 9,
				posterId: 'x',
				url: 'https://images.theposterdb.com/The Gentleman Thief.webp'
			}
		]);
	});

	it('disambiguates same-title members by year', () => {
		const posters = [poster({ posterId: '2', title: 'The Office', year: 2005 })];
		const members = [
			{ mediaItemId: 1, title: 'The Office', year: 2001 },
			{ mediaItemId: 2, title: 'The Office', year: 2005 }
		];
		expect(matchThePosterDbSetToMembers(posters, members).matches).toEqual([
			{ mediaItemId: 2, posterId: '2', url: 'https://images.theposterdb.com/The Office.webp' }
		]);
	});

	it('folds accents and punctuation when matching titles', () => {
		const posters = [poster({ posterId: '3', title: 'Amelie', year: 2001 })];
		const members = [{ mediaItemId: 7, title: 'Amélie', year: 2001 }];
		expect(matchThePosterDbSetToMembers(posters, members).matches).toHaveLength(1);
	});

	it('matches at most one poster per member', () => {
		const posters = [
			poster({ posterId: 'a', title: 'Dupe', year: 2020 }),
			poster({ posterId: 'b', title: 'Dupe', year: 2020 })
		];
		const members = [{ mediaItemId: 5, title: 'Dupe', year: 2020 }];
		expect(matchThePosterDbSetToMembers(posters, members).matches).toEqual([
			{ mediaItemId: 5, posterId: 'a', url: 'https://images.theposterdb.com/Dupe.webp' }
		]);
	});
});

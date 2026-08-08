import { describe, expect, it } from 'vitest';
import {
	dropIndexForPointer,
	moveProvider,
	reorderProviders,
	RANKING_PROVIDERS,
	type RankingProvider
} from './provider-order';

const order: RankingProvider[] = [...RANKING_PROVIDERS];

describe('provider order moves', () => {
	it('steps a provider up and down one position at a time', () => {
		expect(moveProvider(order, 2, -1)).toEqual(['mediux', 'fanarttv', 'theposterdb', 'tmdb']);
		expect(moveProvider(order, 0, 1)).toEqual(['theposterdb', 'mediux', 'fanarttv', 'tmdb']);
	});

	it('clamps at the list bounds instead of wrapping', () => {
		expect(moveProvider(order, 0, -1)).toEqual(order);
		expect(moveProvider(order, order.length - 1, 1)).toEqual(order);
	});

	it('never mutates the array it was given', () => {
		const source: RankingProvider[] = [...order];
		expect(moveProvider(source, 1, -1)).not.toBe(source);
		expect(source).toEqual(order);
	});

	it('ignores an out-of-range source index', () => {
		expect(reorderProviders(order, -1, 0)).toEqual(order);
		expect(reorderProviders(order, 9, 0)).toEqual(order);
		expect(reorderProviders([], 0, 1)).toEqual([]);
	});
});

describe('provider order drag targets', () => {
	it('moves a provider across several positions in one drop', () => {
		expect(reorderProviders(order, 3, 0)).toEqual(['tmdb', 'mediux', 'theposterdb', 'fanarttv']);
		expect(reorderProviders(order, 0, 3)).toEqual(['theposterdb', 'fanarttv', 'tmdb', 'mediux']);
	});

	it('clamps a drop target past either end onto the end row', () => {
		expect(reorderProviders(order, 1, -4)).toEqual(['theposterdb', 'mediux', 'fanarttv', 'tmdb']);
		expect(reorderProviders(order, 1, 40)).toEqual(['mediux', 'fanarttv', 'tmdb', 'theposterdb']);
	});

	it('picks the row whose midpoint the pointer has crossed', () => {
		const rows = [
			{ top: 100, height: 60 },
			{ top: 168, height: 60 },
			{ top: 236, height: 60 }
		];
		expect(dropIndexForPointer(129, rows)).toBe(0);
		expect(dropIndexForPointer(131, rows)).toBe(1);
		expect(dropIndexForPointer(199, rows)).toBe(2);
	});

	it('clamps pointers dragged above or below the list', () => {
		const rows = [
			{ top: 100, height: 40 },
			{ top: 148, height: 40 }
		];
		expect(dropIndexForPointer(-500, rows)).toBe(0);
		expect(dropIndexForPointer(9000, rows)).toBe(1);
	});

	it('reports no target when there are no rows', () => {
		expect(dropIndexForPointer(120, [])).toBe(-1);
	});
});

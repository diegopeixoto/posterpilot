import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetchJson: vi.fn() }));

vi.mock('$lib/server/http', () => ({ fetchJson: h.fetchJson }));

import { listCollections } from './client';

describe('Plex native collection discovery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.fetchJson.mockImplementation(async (url: string) => {
			if (url.includes('/library/sections/1/collections')) {
				return {
					MediaContainer: {
						Metadata: [
							{
								ratingKey: 'collection-a',
								title: 'Shared Name',
								type: 'collection',
								thumb: '/thumb/a',
								art: '/art/a'
							}
						]
					}
				};
			}
			if (url.includes('/library/sections/2/collections')) {
				return {
					MediaContainer: {
						Metadata: [
							{
								ratingKey: 'collection-b',
								title: 'Shared Name',
								type: 'collection'
							}
						]
					}
				};
			}
			if (url.includes('/library/metadata/collection-a/children')) {
				return {
					MediaContainer: {
						Metadata: [{ ratingKey: 'movie-1', title: 'First', year: 2001, type: 'movie' }]
					}
				};
			}
			if (url.includes('/library/metadata/collection-b/children')) {
				return {
					MediaContainer: {
						Metadata: [{ ratingKey: 'movie-2', title: 'Second', year: 2002, type: 'movie' }]
					}
				};
			}
			throw new Error(`Unexpected test URL: ${url}`);
		});
	});

	it('keeps same-name Plex collections distinct by rating key', async () => {
		const result = await listCollections('http://plex', 'secret-token', ['1', '2']);
		expect(result).toHaveLength(2);
		expect(result.map((collection) => [collection.ratingKey, collection.title])).toEqual([
			['collection-a', 'Shared Name'],
			['collection-b', 'Shared Name']
		]);
		expect(result[0].members).toEqual([{ ratingKey: 'movie-1', title: 'First', year: 2001 }]);
		expect(result[1].members).toEqual([{ ratingKey: 'movie-2', title: 'Second', year: 2002 }]);
	});
});

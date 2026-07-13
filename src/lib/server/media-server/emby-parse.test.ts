import { describe, expect, it } from 'vitest';
import {
	buildEmbyLibraryMembershipIndex,
	buildEmbyImageUrl,
	collectionTypeToLibraryType,
	itemTypeToMediaType,
	mapChildren,
	mapItems,
	mapLibraries,
	mapNativeCollection,
	parseProviderIds,
	scopeEmbyCollectionMembers,
	type RawEmbyItemsResponse
} from './emby-parse';

describe('parseProviderIds', () => {
	it('extracts tmdb, imdb, and tvdb ids (case-insensitive keys)', () => {
		expect(parseProviderIds({ Tmdb: '603', Imdb: 'tt0133093', Tvdb: 12345 })).toEqual({
			tmdb: '603',
			imdb: 'tt0133093',
			tvdb: '12345'
		});
	});

	it('stringifies numeric values', () => {
		expect(parseProviderIds({ tmdb: 550 })).toEqual({ tmdb: '550' });
	});

	it('ignores unknown providers', () => {
		expect(parseProviderIds({ MusicBrainzAlbum: 'abc', Tmdb: '1' })).toEqual({ tmdb: '1' });
	});

	it('keeps the first value seen for a duplicated source', () => {
		// Object insertion order: Tmdb wins over tmdb.
		expect(parseProviderIds({ Tmdb: '111', tmdb: '222' })).toEqual({ tmdb: '111' });
	});

	it('skips null/undefined/empty values', () => {
		expect(parseProviderIds({ Tmdb: '', Imdb: null, Tvdb: undefined })).toEqual({});
	});

	it('returns an empty object for null/undefined/non-object input', () => {
		expect(parseProviderIds(null)).toEqual({});
		expect(parseProviderIds(undefined)).toEqual({});
	});
});

describe('collectionTypeToLibraryType', () => {
	it('maps movies and tvshows', () => {
		expect(collectionTypeToLibraryType('movies')).toBe('movie');
		expect(collectionTypeToLibraryType('tvshows')).toBe('show');
		expect(collectionTypeToLibraryType('Movies')).toBe('movie');
	});
	it('returns null for non-media collection types', () => {
		expect(collectionTypeToLibraryType('music')).toBeNull();
		expect(collectionTypeToLibraryType('photos')).toBeNull();
		expect(collectionTypeToLibraryType(undefined)).toBeNull();
		expect(collectionTypeToLibraryType(null)).toBeNull();
	});
});

describe('itemTypeToMediaType', () => {
	it('maps Movie and Series', () => {
		expect(itemTypeToMediaType('Movie')).toBe('movie');
		expect(itemTypeToMediaType('Series')).toBe('show');
		expect(itemTypeToMediaType('movie')).toBe('movie');
	});
	it('returns null for other types', () => {
		expect(itemTypeToMediaType('Episode')).toBeNull();
		expect(itemTypeToMediaType('Folder')).toBeNull();
		expect(itemTypeToMediaType(undefined)).toBeNull();
	});
});

describe('buildEmbyImageUrl', () => {
	it('builds an absolute, api-key-bearing image URL', () => {
		expect(buildEmbyImageUrl('http://jelly:8096', 'item1', 'Primary', 'tagABC', 'key1')).toBe(
			'http://jelly:8096/Items/item1/Images/Primary?tag=tagABC&api_key=key1'
		);
	});
	it('strips a trailing slash from the base url', () => {
		expect(buildEmbyImageUrl('http://jelly:8096/', 'i', 'Backdrop', 't', 'k')).toBe(
			'http://jelly:8096/Items/i/Images/Backdrop?tag=t&api_key=k'
		);
	});
	it('url-encodes id, tag, and key', () => {
		expect(buildEmbyImageUrl('http://x', 'a b', 'Primary', 't/g', 'k=1')).toBe(
			'http://x/Items/a%20b/Images/Primary?tag=t%2Fg&api_key=k%3D1'
		);
	});
	it('returns null when no tag is present', () => {
		expect(buildEmbyImageUrl('http://x', 'i', 'Primary', null, 'k')).toBeNull();
		expect(buildEmbyImageUrl('http://x', 'i', 'Primary', undefined, 'k')).toBeNull();
		expect(buildEmbyImageUrl('http://x', 'i', 'Primary', '', 'k')).toBeNull();
	});
});

describe('mapLibraries', () => {
	it('keeps only movie/show libraries with their type', () => {
		const res: RawEmbyItemsResponse = {
			Items: [
				{ Id: '1', Name: 'Movies', CollectionType: 'movies' },
				{ Id: '2', Name: 'TV', CollectionType: 'tvshows' },
				{ Id: '3', Name: 'Music', CollectionType: 'music' },
				{ Id: '4', Name: 'Mixed', CollectionType: undefined }
			]
		};
		expect(mapLibraries(res)).toEqual([
			{ key: '1', title: 'Movies', type: 'movie' },
			{ key: '2', title: 'TV', type: 'show' }
		]);
	});
	it('handles an empty/missing response', () => {
		expect(mapLibraries(null)).toEqual([]);
		expect(mapLibraries({})).toEqual([]);
	});
});

describe('mapChildren', () => {
	it('preserves numbered child artwork identities and last-modified metadata', () => {
		const result = mapChildren(
			{
				Items: [
					{
						Id: 'season-1',
						IndexNumber: 1,
						ImageTags: { Primary: 'poster-tag' },
						BackdropImageTags: ['background-tag'],
						DateLastModified: '2026-07-10T12:30:00.000Z'
					},
					{ Id: 'specials' }
				]
			},
			'http://jellyfin:8096',
			'key'
		);
		expect(result).toEqual([
			{
				id: 'season-1',
				number: 1,
				currentPosterUrl:
					'http://jellyfin:8096/Items/season-1/Images/Primary?tag=poster-tag&api_key=key',
				currentBackgroundUrl:
					'http://jellyfin:8096/Items/season-1/Images/Backdrop?tag=background-tag&api_key=key',
				serverUpdatedAt: new Date('2026-07-10T12:30:00.000Z')
			}
		]);
	});

	it('returns explicit null artwork metadata when mapping without a connection', () => {
		expect(mapChildren({ Items: [{ Id: 'episode-2', IndexNumber: 2 }] })).toEqual([
			{
				id: 'episode-2',
				number: 2,
				currentPosterUrl: null,
				currentBackgroundUrl: null,
				serverUpdatedAt: null
			}
		]);
	});
});

describe('mapItems', () => {
	const base = 'http://jelly:8096';
	const key = 'apikey';

	it('maps movies and series with guids and image URLs', () => {
		const res: RawEmbyItemsResponse = {
			Items: [
				{
					Id: 'm1',
					Name: 'The Matrix',
					ProductionYear: 1999,
					Type: 'Movie',
					ProviderIds: { Tmdb: '603', Imdb: 'tt0133093' },
					ImageTags: { Primary: 'ptag' },
					BackdropImageTags: ['btag'],
					DateLastModified: '2023-11-14T22:13:20.000Z'
				},
				{
					Id: 's1',
					Name: 'Breaking Bad',
					ProductionYear: 2008,
					Type: 'Series',
					ProviderIds: { Tvdb: '81189' },
					ImageTags: { Primary: 'ptag2' }
				}
			]
		};
		expect(mapItems(res, base, key)).toEqual([
			{
				id: 'm1',
				title: 'The Matrix',
				year: 1999,
				type: 'movie',
				guids: { tmdb: '603', imdb: 'tt0133093' },
				currentPosterUrl: `${base}/Items/m1/Images/Primary?tag=ptag&api_key=${key}`,
				currentBackgroundUrl: `${base}/Items/m1/Images/Backdrop?tag=btag&api_key=${key}`,
				serverUpdatedAt: new Date('2023-11-14T22:13:20.000Z'),
				addedAt: null,
				watched: false
			},
			{
				id: 's1',
				title: 'Breaking Bad',
				year: 2008,
				type: 'show',
				guids: { tvdb: '81189' },
				currentPosterUrl: `${base}/Items/s1/Images/Primary?tag=ptag2&api_key=${key}`,
				currentBackgroundUrl: null,
				serverUpdatedAt: null,
				addedAt: null,
				watched: false
			}
		]);
	});

	it('maps DateCreated to addedAt, null when missing or invalid', () => {
		const res: RawEmbyItemsResponse = {
			Items: [
				{ Id: 'a', Name: 'Dated', Type: 'Movie', DateCreated: '2024-05-06T07:08:09.000Z' },
				{ Id: 'b', Name: 'Missing', Type: 'Movie' },
				{ Id: 'c', Name: 'Invalid', Type: 'Movie', DateCreated: 'not-a-date' }
			]
		};
		const items = mapItems(res, base, key);
		expect(items[0].addedAt).toEqual(new Date('2024-05-06T07:08:09.000Z'));
		expect(items[1].addedAt).toBeNull();
		expect(items[2].addedAt).toBeNull();
	});

	it('maps UserData.Played to watched, false when absent', () => {
		const res: RawEmbyItemsResponse = {
			Items: [
				{ Id: 'a', Name: 'Seen', Type: 'Movie', UserData: { Played: true } },
				{ Id: 'b', Name: 'Unseen', Type: 'Movie', UserData: { Played: false } },
				{ Id: 'c', Name: 'NoData', Type: 'Series' },
				{ Id: 'd', Name: 'NullPlayed', Type: 'Movie', UserData: { Played: null } }
			]
		};
		const items = mapItems(res, base, key);
		expect(items.map((i) => i.watched)).toEqual([true, false, false, false]);
	});

	it('maps DateLastModified to serverUpdatedAt, null when missing or invalid', () => {
		const res: RawEmbyItemsResponse = {
			Items: [
				{ Id: 'a', Name: 'Dated', Type: 'Movie', DateLastModified: '2024-01-02T03:04:05.000Z' },
				{ Id: 'b', Name: 'Missing', Type: 'Movie' },
				{ Id: 'c', Name: 'Invalid', Type: 'Movie', DateLastModified: 'not-a-date' }
			]
		};
		const items = mapItems(res, base, key);
		expect(items[0].serverUpdatedAt).toEqual(new Date('2024-01-02T03:04:05.000Z'));
		expect(items[1].serverUpdatedAt).toBeNull();
		expect(items[2].serverUpdatedAt).toBeNull();
	});

	it('drops non-movie/series items but keeps guid-less items flagged unresolvable', () => {
		const res: RawEmbyItemsResponse = {
			Items: [
				{ Id: 'f1', Name: 'Folder', Type: 'Folder' },
				{ Id: 'm2', Name: 'No Ids', Type: 'Movie' }
			]
		};
		const items = mapItems(res, base, key);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ id: 'm2', guids: {}, currentPosterUrl: null });
	});

	it('handles an empty/missing response', () => {
		expect(mapItems(null, base, key)).toEqual([]);
		expect(mapItems({}, base, key)).toEqual([]);
	});
});

describe('mapNativeCollection', () => {
	it('maps a BoxSet by native ids and never by title', () => {
		const result = mapNativeCollection(
			{
				Id: 'boxset-1',
				Name: 'Shared Name',
				Type: 'BoxSet',
				ImageTags: { Primary: 'poster-tag' },
				BackdropImageTags: ['backdrop-tag']
			},
			{
				Items: [
					{ Id: 'movie-1', Name: 'First', ProductionYear: 2001, Type: 'Movie' },
					{ Id: 'movie-2', Name: 'Second', ProductionYear: 2002, Type: 'Movie' }
				]
			},
			'http://jelly:8096',
			'key',
			['library-a']
		);
		expect(result).toMatchObject({
			id: 'boxset-1',
			name: 'Shared Name',
			members: [
				{ id: 'movie-1', title: 'First', year: 2001 },
				{ id: 'movie-2', title: 'Second', year: 2002 }
			],
			libraryKeys: ['library-a'],
			capabilities: { posterWrite: 'supported', backgroundWrite: 'supported' }
		});
		expect(result?.currentPosterUrl).toContain('/Items/boxset-1/Images/Primary');
	});

	it('ignores non-BoxSet rows even when the display name matches', () => {
		expect(
			mapNativeCollection(
				{ Id: 'folder-1', Name: 'Shared Name', Type: 'Folder' },
				{ Items: [] },
				'http://jelly',
				'key',
				[]
			)
		).toBeNull();
	});
});

describe('native collection library scoping', () => {
	it('keeps only exact member ids from selected libraries and derives real library intersections', () => {
		const membership = buildEmbyLibraryMembershipIndex([
			{
				libraryKey: 'library-a',
				response: {
					Items: [
						{ Id: 'movie-a', Type: 'Movie' },
						{ Id: 'movie-shared', Type: 'Movie' }
					]
				}
			},
			{
				libraryKey: 'library-b',
				response: {
					Items: [
						{ Id: 'movie-b', Type: 'Movie' },
						{ Id: 'movie-shared', Type: 'Movie' }
					]
				}
			}
		]);

		const scoped = scopeEmbyCollectionMembers(
			{
				Items: [
					{ Id: 'movie-a', Name: 'Selected A', Type: 'Movie' },
					{ Id: 'movie-external', Name: 'External', Type: 'Movie' },
					{ Id: 'movie-shared', Name: 'Selected twice', Type: 'Movie' },
					{ Id: 'movie-b', Name: 'Selected B', Type: 'Movie' }
				]
			},
			membership
		);

		expect(scoped.membersResponse.Items?.map((item) => item.Id)).toEqual([
			'movie-a',
			'movie-shared',
			'movie-b'
		]);
		expect(scoped.libraryKeys).toEqual(['library-a', 'library-b']);
	});

	it('returns no scope for a same-named collection whose members are all external', () => {
		const membership = buildEmbyLibraryMembershipIndex([
			{
				libraryKey: 'selected-library',
				response: { Items: [{ Id: 'selected-item', Name: 'Saga', Type: 'Movie' }] }
			}
		]);

		expect(
			scopeEmbyCollectionMembers(
				{ Items: [{ Id: 'external-item', Name: 'Saga', Type: 'Movie' }] },
				membership
			)
		).toEqual({ membersResponse: { Items: [] }, libraryKeys: [] });
	});

	it('deduplicates duplicate library snapshots and member ids without using names', () => {
		const membership = buildEmbyLibraryMembershipIndex([
			{
				libraryKey: 'library-a',
				response: {
					Items: [
						{ Id: 'member-1', Name: 'First', Type: 'Movie' },
						{ Id: 'member-1', Name: 'Duplicate', Type: 'Movie' }
					]
				}
			},
			{ libraryKey: 'library-a', response: { Items: [{ Id: 'member-1', Type: 'Movie' }] } }
		]);
		const scoped = scopeEmbyCollectionMembers(
			{
				Items: [
					{ Id: 'member-1', Name: 'Original member', Type: 'Movie' },
					{ Id: 'member-1', Name: 'Duplicate member', Type: 'Movie' }
				]
			},
			membership
		);

		expect(scoped.membersResponse.Items).toHaveLength(1);
		expect(scoped.libraryKeys).toEqual(['library-a']);
	});
});

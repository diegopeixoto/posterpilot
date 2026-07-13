import { afterEach, describe, expect, it, vi } from 'vitest';
import { embyLikeProvider } from './emby';
import type { RawEmbyItemsResponse } from './emby-parse';

function jsonResponse(body: RawEmbyItemsResponse): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function installCollectionApiFixture() {
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		const itemTypes = url.searchParams.get('IncludeItemTypes');
		const parentId = url.searchParams.get('ParentId');

		if (url.pathname !== '/Items') throw new Error(`Unexpected request: ${url}`);
		if (itemTypes === 'BoxSet' && parentId === null) {
			return jsonResponse({
				Items: [
					{ Id: 'box-a', Name: 'Saga', Type: 'BoxSet' },
					{ Id: 'box-b', Name: 'Saga', Type: 'BoxSet' },
					{ Id: 'box-shared', Name: 'Shared set', Type: 'BoxSet' },
					{ Id: 'box-external', Name: 'Saga', Type: 'BoxSet' }
				]
			});
		}

		const itemsByParent: Record<string, RawEmbyItemsResponse> = {
			'library-a': {
				Items: [
					{ Id: 'movie-a', Name: 'Library A', Type: 'Movie' },
					{ Id: 'movie-shared', Name: 'Shared A', Type: 'Movie' }
				]
			},
			'library-b': {
				Items: [
					{ Id: 'movie-b', Name: 'Library B', Type: 'Movie' },
					{ Id: 'movie-shared', Name: 'Shared B', Type: 'Movie' }
				]
			},
			'box-a': {
				Items: [
					{ Id: 'movie-a', Name: 'Member A', Type: 'Movie' },
					{ Id: 'movie-external', Name: 'External', Type: 'Movie' }
				]
			},
			'box-b': { Items: [{ Id: 'movie-b', Name: 'Member B', Type: 'Movie' }] },
			'box-shared': {
				Items: [
					{ Id: 'movie-a', Name: 'Member A', Type: 'Movie' },
					{ Id: 'movie-b', Name: 'Member B', Type: 'Movie' }
				]
			},
			'box-external': {
				Items: [{ Id: 'movie-external', Name: 'External', Type: 'Movie' }]
			}
		};
		if (itemTypes === 'Movie,Series' && parentId && itemsByParent[parentId]) {
			return jsonResponse(itemsByParent[parentId]);
		}

		throw new Error(`Unexpected request: ${url}`);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('embyLikeProvider native collection scoping', () => {
	it('omits external collections and filters members to the selected library', async () => {
		installCollectionApiFixture();
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const collections = await provider.listNativeCollections!(['library-a']);

		expect(collections.map((collection) => collection.id)).toEqual(['box-a', 'box-shared']);
		expect(collections).toMatchObject([
			{
				id: 'box-a',
				members: [{ id: 'movie-a', title: 'Member A' }],
				libraryKeys: ['library-a']
			},
			{
				id: 'box-shared',
				members: [{ id: 'movie-a', title: 'Member A' }],
				libraryKeys: ['library-a']
			}
		]);
	});

	it('derives each collection library scope from real member intersections', async () => {
		const fetchMock = installCollectionApiFixture();
		const provider = embyLikeProvider('http://emby.local', 'secret', 'emby');

		const collections = await provider.listNativeCollections!([
			'library-a',
			'library-b',
			'library-a'
		]);

		expect(collections.map((collection) => collection.id)).toEqual([
			'box-a',
			'box-b',
			'box-shared'
		]);
		expect(collections.map((collection) => collection.libraryKeys)).toEqual([
			['library-a'],
			['library-b'],
			['library-a', 'library-b']
		]);
		const libraryQueries = fetchMock.mock.calls
			.map(([input]) => new URL(input instanceof Request ? input.url : input.toString()))
			.filter((url) => url.searchParams.get('ParentId')?.startsWith('library-'));
		expect(libraryQueries).toHaveLength(2);
		expect(
			libraryQueries.every((url) => url.searchParams.get('GroupItemsIntoCollections') === 'false')
		).toBe(true);
	});

	it('does not perform global discovery without a selected library', async () => {
		const fetchMock = installCollectionApiFixture();
		const provider = embyLikeProvider('http://emby.local', 'secret', 'emby');

		await expect(provider.listNativeCollections!([])).resolves.toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

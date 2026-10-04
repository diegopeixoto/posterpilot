import { afterEach, describe, expect, it, vi } from 'vitest';
import { embyLikeProvider } from './emby';

/**
 * Jellyfin's item update endpoint (`POST /Items/{itemId}`) assigns request fields
 * onto the stored item unconditionally — a partial DTO would wipe Name, Overview,
 * Genres, ProviderIds, and more. Locking must therefore round-trip the complete
 * item DTO read from the user-scoped single-item endpoint (the same round-trip the
 * Jellyfin web metadata editor performs), with only `LockData` changed.
 *
 * The userless list form (`/Items?ids=…`) returns an incomplete DTO (no
 * `ProviderIds`), so it must never feed the update write.
 */

const FULL_ITEM_DTO = {
	Id: 'item-1',
	Name: 'Casino Royale',
	Overview: 'Bond must win a high-stakes poker game.',
	Genres: ['Action', 'Thriller'],
	People: [{ Name: 'Daniel Craig', Type: 'Actor' }],
	Studios: [{ Name: 'Eon' }],
	Tags: ['bond'],
	ProviderIds: { Tmdb: '36557', Imdb: 'tt0381061' },
	ProductionYear: 2006,
	PremiereDate: '2006-11-14T00:00:00Z',
	CommunityRating: 7.6,
	LockData: false,
	LockedFields: [],
	// Present in real user-scoped DTOs; the update endpoint cannot deserialize
	// it (TrickplayInfoDto constructor binding), so the lock write strips it.
	Trickplay: {
		'item-1': {
			320: {
				Bandwidth: 9480,
				Height: 132,
				Interval: 10000,
				ThumbnailCount: 867,
				TileHeight: 10,
				TileWidth: 10,
				Width: 320
			}
		}
	}
};

function installStatefulServer(itemId: string) {
	let lockData = false;
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		const method = init?.method ?? 'GET';

		if (url.pathname === '/Users') {
			return new Response(JSON.stringify([{ Id: 'admin-1', Policy: { IsAdministrator: true } }]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (method === 'GET' && url.pathname === `/Users/admin-1/Items/${itemId}`) {
			return new Response(JSON.stringify({ ...FULL_ITEM_DTO, LockData: lockData }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (method === 'POST' && url.pathname === `/Items/${itemId}`) {
			const body = JSON.parse(String(init?.body));
			if (body.Id !== itemId) throw new Error('update body must carry the item id');
			lockData = body.LockData === true;
			return new Response(null, { status: 204 });
		}
		throw new Error(`Unexpected ${method} ${url.pathname}?${url.searchParams}`);
	});
	vi.stubGlobal('fetch', fetchMock);
	return {
		lock: () => lockData,
		posts: () =>
			fetchMock.mock.calls.filter(([input, init]) => {
				const url = new URL(input instanceof Request ? input.url : input.toString());
				return (init?.method ?? 'GET') === 'POST' && url.pathname === `/Items/${itemId}`;
			}) as Array<[RequestInfo, RequestInit]>
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('emby lockField (Jellyfin LockData)', () => {
	it('round-trips the full item DTO and sets LockData on lock', async () => {
		const server = installStatefulServer('item-1');
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.lockField('item-1', 'poster', true);

		expect(server.lock()).toBe(true);
		const [url, init] = server.posts()[0];
		const body = JSON.parse(String(init?.body));
		expect(new URL(url.toString()).pathname).toBe('/Items/item-1');
		expect(body.LockData).toBe(true);
		// Every metadata-bearing field survives the round-trip.
		expect(body.Name).toBe(FULL_ITEM_DTO.Name);
		expect(body.Overview).toBe(FULL_ITEM_DTO.Overview);
		expect(body.Genres).toEqual(FULL_ITEM_DTO.Genres);
		expect(body.People).toEqual(FULL_ITEM_DTO.People);
		expect(body.ProviderIds).toEqual(FULL_ITEM_DTO.ProviderIds);
		expect(body.PremiereDate).toBe(FULL_ITEM_DTO.PremiereDate);
		// Trickplay cannot round-trip (the update endpoint 500s deserializing it),
		// so the write strips it; every other field must survive.
		expect(body.Trickplay).toBeUndefined();
	});

	it('clears LockData on unlock for revert', async () => {
		const server = installStatefulServer('item-1');
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.lockField('item-1', 'background', true);
		expect(server.lock()).toBe(true);

		await provider.lockField('item-1', 'poster', false);
		expect(server.lock()).toBe(false);
	});

	it('locks through the item-level contract regardless of which artwork field is named', async () => {
		const server = installStatefulServer('item-1');
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		// Jellyfin has no per-image lock; both fields map to the same item-level LockData.
		await provider.lockField('item-1', 'background', true);

		expect(server.lock()).toBe(true);
	});

	it('fails closed when no administrator user is resolvable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify([{ Id: 'u1', Policy: { IsAdministrator: false } }]), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
			)
		);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await expect(provider.lockField('item-1', 'poster', true)).rejects.toThrow(/administrator/i);
	});

	it('never writes when the full item read fails, so metadata cannot be wiped', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			const method = init?.method ?? 'GET';
			if (url.pathname === '/Users') {
				return new Response(
					JSON.stringify([{ Id: 'admin-1', Policy: { IsAdministrator: true } }]),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			if (method === 'GET' && url.pathname === '/Users/admin-1/Items/item-1') {
				return new Response(null, { status: 500 });
			}
			throw new Error(`Unexpected ${method} ${url.pathname}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await expect(provider.lockField('item-1', 'poster', true)).rejects.toThrow();
		// Only /Users and the item read happened — no update write.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

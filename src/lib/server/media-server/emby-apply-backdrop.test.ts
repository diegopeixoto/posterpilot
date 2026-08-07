import { afterEach, describe, expect, it, vi } from 'vitest';
import { embyLikeProvider } from './emby';

/**
 * Jellyfin's `POST /Items/{id}/Images/Backdrop` APPENDS a backdrop, so the new image
 * lands behind the existing one(s). Jellyfin/Infuse show `BackdropImageTags[0]`, and
 * v0.9.0's post-write verification reads that same [0]; when the prior backdrop stays
 * at [0] the write is reported as `artwork_unchanged_after_write` and the user keeps
 * seeing the old art. Applying a background must therefore clear the existing backdrops
 * first so the new one is the sole (index 0) backdrop.
 *
 * Crucially, `BackdropImageTags` is ordered by resolution, NOT by the index that
 * `DELETE /Images/Backdrop/{i}` uses, so deletion must not trust a response-derived
 * index. The implementation deletes index 0 repeatedly; this fixture would expose a
 * wrong-index deletion because the deleted tag is chosen by position, not by value.
 */
function installStatefulBackdropServer(itemId: string, initial: string[]) {
	// Response order (resolution-sorted) is deliberately the REVERSE of insertion order,
	// so any "delete by the index I saw in the response" logic would hit the wrong image.
	const backdrops = [...initial];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		const method = init?.method ?? 'GET';

		if (url.pathname === '/Items' && url.searchParams.get('ids') === itemId) {
			return new Response(
				JSON.stringify({ Items: [{ Id: itemId, BackdropImageTags: [...backdrops].reverse() }] }),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}
		if (method === 'POST' && url.pathname === `/Items/${itemId}/Images/Backdrop`) {
			backdrops.push('new'); // Jellyfin appends
			return new Response(null, { status: 204 });
		}
		const del = url.pathname.match(new RegExp(`^/Items/${itemId}/Images/Backdrop/(\\d+)$`));
		if (method === 'DELETE' && del) {
			backdrops.splice(Number(del[1]), 1); // by internal (insertion) index
			return new Response(null, { status: 204 });
		}
		throw new Error(`Unexpected ${method} ${url.pathname}?${url.searchParams}`);
	});
	vi.stubGlobal('fetch', fetchMock);
	return () => backdrops;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('applyBackground replaces instead of appending', () => {
	it('clears every prior backdrop so only the new one remains at index 0', async () => {
		const backdrops = installStatefulBackdropServer('item-1', ['old-a', 'old-b']);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.applyBackgroundBytes!('item-1', new Uint8Array([9, 9, 9]).buffer, 'image/jpeg');

		expect(backdrops()).toEqual(['new']);
	});

	it('writes the backdrop when the item had none, without a spurious delete', async () => {
		const backdrops = installStatefulBackdropServer('item-2', []);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.applyBackgroundBytes!('item-2', new Uint8Array([1]).buffer, 'image/jpeg');

		expect(backdrops()).toEqual(['new']);
	});

	it('still writes the backdrop when the count read fails, skipping the prune', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			const method = init?.method ?? 'GET';
			if (url.pathname === '/Items') {
				return new Response('boom', { status: 500 });
			}
			if (method === 'POST' && url.pathname === '/Items/item-3/Images/Backdrop') {
				return new Response(null, { status: 204 });
			}
			throw new Error(`Unexpected ${method} ${url.pathname}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.applyBackgroundBytes!('item-3', new Uint8Array([1]).buffer, 'image/jpeg');

		const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
		expect(posts).toHaveLength(1);
	});
});

describe('remote artwork apply', () => {
	it('preserves a custom HTTP origin while securely following a same-origin redirect', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.href === 'http://artwork.local/start.jpg') {
				expect(init?.redirect).toBe('manual');
				return new Response(null, { status: 302, headers: { location: '/final.png' } });
			}
			if (url.href === 'http://artwork.local/final.png') {
				return new Response(new Uint8Array([1, 2, 3]), {
					headers: { 'content-type': 'image/png' }
				});
			}
			if (url.href === 'http://jellyfin.local/Items/item-4/Images/Primary') {
				expect(init?.method).toBe('POST');
				expect(init?.body).toBe('AQID');
				expect(new Headers(init?.headers).get('content-type')).toBe('image/png');
				return new Response(null, { status: 204 });
			}
			throw new Error(`Unexpected ${init?.method ?? 'GET'} ${url.href}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.applyPosterUrl!('item-4', 'http://artwork.local/start.jpg');

		expect(fetchMock.mock.calls.map(([input]) => input.toString())).toEqual([
			'http://artwork.local/start.jpg',
			'http://artwork.local/final.png',
			'http://jellyfin.local/Items/item-4/Images/Primary'
		]);
	});

	it('follows redirects within a known public provider family before uploading', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.href === 'https://theposterdb.com/poster/42') {
				return new Response(null, {
					status: 302,
					headers: { location: 'https://www.theposterdb.com/poster/42' }
				});
			}
			if (url.href === 'https://www.theposterdb.com/poster/42') {
				return new Response(null, {
					status: 302,
					headers: { location: 'https://images.theposterdb.com/posters/42.jpg' }
				});
			}
			if (url.href === 'https://images.theposterdb.com/posters/42.jpg') {
				return new Response(new Uint8Array([4, 2]), {
					headers: { 'content-type': 'image/jpeg' }
				});
			}
			if (url.href === 'http://jellyfin.local/Items/item-6/Images/Primary') {
				expect(init?.method).toBe('POST');
				expect(init?.body).toBe('BAI=');
				return new Response(null, { status: 204 });
			}
			throw new Error(`Unexpected ${init?.method ?? 'GET'} ${url.href}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await provider.applyPosterUrl!('item-6', 'https://theposterdb.com/poster/42');

		expect(fetchMock.mock.calls.map(([input]) => input.toString())).toEqual([
			'https://theposterdb.com/poster/42',
			'https://www.theposterdb.com/poster/42',
			'https://images.theposterdb.com/posters/42.jpg',
			'http://jellyfin.local/Items/item-6/Images/Primary'
		]);
	});

	it('rejects a cross-origin redirect before requesting the target or uploading', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'http://127.0.0.1/private.jpg' }
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		await expect(
			provider.applyPosterUrl!('item-5', 'https://artwork.example/start.jpg')
		).rejects.toThrow('remote_artwork_target_not_allowed');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

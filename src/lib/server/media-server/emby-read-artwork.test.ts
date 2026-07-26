import { afterEach, describe, expect, it, vi } from 'vitest';
import { embyLikeProvider } from './emby';

/**
 * Jellyfin 10.11.x rejects the global single-item metadata read `GET /Items/{id}`
 * with HTTP 400 ("Error processing request"); only the userless list form
 * `GET /Items?ids={id}` still works with an API key. readCurrentArtwork must read
 * the item's current ImageTags through the form the server actually accepts, or
 * every apply that has a staged selection dies while planning.
 */
function installJellyfin1011Fixture(itemId: string) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		// The image endpoint must keep working (existence probe + byte read).
		if (url.pathname === `/Items/${itemId}/Images/Primary`) {
			return new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { 'content-type': 'image/jpeg' }
			});
		}
		// Jellyfin 10.11.x: the global single-item metadata read is gone.
		if (url.pathname === `/Items/${itemId}`) {
			return new Response('Error processing request.', { status: 400 });
		}
		// The list form is what 10.11.x still serves.
		if (url.pathname === '/Items' && url.searchParams.get('ids') === itemId) {
			return new Response(
				JSON.stringify({
					Items: [{ Id: itemId, ImageTags: { Primary: 'ptag' }, BackdropImageTags: ['btag'] }]
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}
		throw new Error(`Unexpected request: ${url.pathname}?${url.searchParams}`);
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('readCurrentArtwork on Jellyfin 10.11.x', () => {
	it('reads the current poster via the list endpoint the server accepts', async () => {
		vi.stubGlobal('fetch', installJellyfin1011Fixture('item-1'));
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const art = await provider.readArtwork!('item-1', 'poster');

		expect(art).not.toBeNull();
		expect(art?.identity).toBe('ptag');
		expect(art?.url).toContain('/Items/item-1/Images/Primary?tag=ptag');
	});
});

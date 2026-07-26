import { afterEach, describe, expect, it, vi } from 'vitest';
import { embyLikeProvider } from './emby';

/**
 * The same userless-`/Items` leak that listItems fixed (merged versions doubled,
 * library extras surfaced, no UserData) applies to every other list read: seasons,
 * episodes, and the three reads inside listNativeCollections. They must all route
 * through `/Users/{id}/Items` when an admin resolves — the collection member-id
 * intersection in particular breaks when the snapshot side and the library sync
 * see different ids for the same merged item — and fall back to the userless list
 * only when no user resolves.
 */
function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('listSeasons and listEpisodes read children the way the user sees them', () => {
	it('reads seasons via /Users/{id}/Items when an admin resolves', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') {
				return json([{ Id: 'admin', Name: 'Nass', Policy: { IsAdministrator: true } }]);
			}
			if (url.pathname === '/Users/admin/Items') {
				expect(url.searchParams.get('ParentId')).toBe('show-1');
				expect(url.searchParams.get('IncludeItemTypes')).toBe('Season');
				return json({ Items: [{ Id: 'season-1', Type: 'Season', IndexNumber: 1 }] });
			}
			throw new Error(`Unexpected request: ${url.pathname}?${url.searchParams}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const seasons = await provider.listSeasons('show-1');

		expect(seasons.map((season) => season.id)).toEqual(['season-1']);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths).not.toContain('/Items');
	});

	it('reads episodes via /Users/{id}/Items when an admin resolves', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') {
				return json([{ Id: 'admin', Name: 'Nass', Policy: { IsAdministrator: true } }]);
			}
			if (url.pathname === '/Users/admin/Items') {
				expect(url.searchParams.get('ParentId')).toBe('season-1');
				expect(url.searchParams.get('IncludeItemTypes')).toBe('Episode');
				return json({ Items: [{ Id: 'episode-1', Type: 'Episode', IndexNumber: 1 }] });
			}
			throw new Error(`Unexpected request: ${url.pathname}?${url.searchParams}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const episodes = await provider.listEpisodes('season-1');

		expect(episodes.map((episode) => episode.id)).toEqual(['episode-1']);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths).not.toContain('/Items');
	});

	it('falls back to the userless list when the server exposes no users', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') return json([]);
			if (url.pathname === '/Items') {
				return json({ Items: [{ Id: 'season-1', Type: 'Season', IndexNumber: 1 }] });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const seasons = await provider.listSeasons('show-1');
		const episodes = await provider.listEpisodes('season-1');

		expect(seasons.map((season) => season.id)).toEqual(['season-1']);
		expect(episodes.map((episode) => episode.id)).toEqual(['season-1']);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths).toContain('/Items');
	});
});

describe('listNativeCollections reads snapshots, box sets, and members user-scoped', () => {
	it('routes all three reads through /Users/{id}/Items when an admin resolves', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') {
				return json([{ Id: 'admin', Name: 'Nass', Policy: { IsAdministrator: true } }]);
			}
			if (url.pathname === '/Users/admin/Items') {
				// Library snapshot: the movies the user actually sees in lib-1.
				if (url.searchParams.get('ParentId') === 'lib-1') {
					return json({
						Items: [{ Id: 'm1', Name: 'Member', Type: 'Movie', ProductionYear: 2020 }]
					});
				}
				// BoxSet listing.
				if (url.searchParams.get('IncludeItemTypes') === 'BoxSet') {
					return json({ Items: [{ Id: 'box-1', Name: 'Box', Type: 'BoxSet' }] });
				}
				// BoxSet member read.
				if (url.searchParams.get('ParentId') === 'box-1') {
					return json({
						Items: [{ Id: 'm1', Name: 'Member', Type: 'Movie', ProductionYear: 2020 }]
					});
				}
			}
			throw new Error(`Unexpected request: ${url.pathname}?${url.searchParams}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const collections = await provider.listNativeCollections!(['lib-1']);

		expect(collections.map((collection) => collection.id)).toEqual(['box-1']);
		expect(collections[0].members.map((member) => member.id)).toEqual(['m1']);
		expect(collections[0].libraryKeys).toEqual(['lib-1']);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths).not.toContain('/Items');
		expect(paths.filter((path) => path === '/Users/admin/Items')).toHaveLength(3);
	});

	it('falls back to the userless list for every read when no user resolves', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') return json([]);
			if (url.pathname === '/Items') {
				if (url.searchParams.get('ParentId') === 'lib-1') {
					return json({
						Items: [{ Id: 'm1', Name: 'Member', Type: 'Movie', ProductionYear: 2020 }]
					});
				}
				if (url.searchParams.get('IncludeItemTypes') === 'BoxSet') {
					return json({ Items: [{ Id: 'box-1', Name: 'Box', Type: 'BoxSet' }] });
				}
				if (url.searchParams.get('ParentId') === 'box-1') {
					return json({
						Items: [{ Id: 'm1', Name: 'Member', Type: 'Movie', ProductionYear: 2020 }]
					});
				}
			}
			throw new Error(`Unexpected request: ${url.pathname}?${url.searchParams}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const collections = await provider.listNativeCollections!(['lib-1']);

		expect(collections.map((collection) => collection.id)).toEqual(['box-1']);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths.filter((path) => path === '/Items')).toHaveLength(3);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { embyLikeProvider } from './emby';

/**
 * Jellyfin returns each merged version (MergeVersions) as its own top-level item on the
 * userless `/Items` list, and also surfaces library extras there, so a bare-key sync sees
 * phantom duplicates (the same movie twice) plus extras the user never sees. The
 * user-scoped `/Users/{id}/Items` endpoint is what the Jellyfin UI itself reads: it
 * collapses merged versions into one item, hides extras, and is the only form that carries
 * UserData (watched). listItems must read through it, falling back to the userless list
 * only when no user resolves so a degraded server still syncs.
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

describe('listItems reads the library the way the user sees it', () => {
	it('collapses merged versions, drops extras, and reports watched via /Users/{id}/Items', async () => {
		const bareItems = [
			{ Id: 'a', Name: 'Merged Movie', Type: 'Movie', ProductionYear: 2024, UserData: { Played: false } },
			{ Id: 'a-alt', Name: 'Merged Movie', Type: 'Movie', ProductionYear: 2024, UserData: { Played: false } },
			{ Id: 'extra', Name: 'Deleted Scene', Type: 'Movie', ProductionYear: 2024, UserData: { Played: false } }
		];
		const userItems = [
			{ Id: 'a', Name: 'Merged Movie', Type: 'Movie', ProductionYear: 2024, UserData: { Played: true } }
		];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') {
				return json([{ Id: 'user-1', Name: 'Nass', Policy: { IsAdministrator: true } }]);
			}
			if (url.pathname === '/Users/user-1/Items') {
				return json({ Items: userItems, TotalRecordCount: userItems.length });
			}
			if (url.pathname === '/Items') {
				return json({ Items: bareItems, TotalRecordCount: bareItems.length });
			}
			throw new Error(`Unexpected request: ${url.pathname}?${url.searchParams}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const items = await provider.listItems('lib-1');

		expect(items.map((item) => item.id)).toEqual(['a']);
		expect(items[0].watched).toBe(true);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths).toContain('/Users/user-1/Items');
		expect(paths).not.toContain('/Items');
	});

	it('prefers an administrator when several users exist', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') {
				return json([
					{ Id: 'guest', Name: 'Guest', Policy: { IsAdministrator: false } },
					{ Id: 'admin', Name: 'Nass', Policy: { IsAdministrator: true } }
				]);
			}
			if (url.pathname === '/Users/admin/Items') {
				return json({ Items: [{ Id: 'z', Name: 'Solo', Type: 'Movie', ProductionYear: 2020 }] });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const items = await provider.listItems('lib-1');

		expect(items.map((item) => item.id)).toEqual(['z']);
	});

	it('falls back to the userless list when the server exposes no users', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname === '/Users') return json([]);
			if (url.pathname === '/Items') {
				return json({ Items: [{ Id: 'x', Name: 'Solo', Type: 'Movie', ProductionYear: 2020 }] });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		const provider = embyLikeProvider('http://jellyfin.local', 'secret', 'jellyfin');

		const items = await provider.listItems('lib-1');

		expect(items.map((item) => item.id)).toEqual(['x']);
		const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
		expect(paths).toContain('/Items');
	});
});

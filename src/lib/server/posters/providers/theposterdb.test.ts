import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import { thePosterDbProvider } from './theposterdb';
import { ThePosterDbAuthError } from './theposterdb-auth';
import { invalidateThePosterDbSession } from './theposterdb-session';

vi.mock('$lib/server/http', () => ({ fetchText: vi.fn() }));
vi.mock('./theposterdb-auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('./theposterdb-auth')>()),
	loginToThePosterDb: vi.fn()
}));
import { fetchText } from '$lib/server/http';
import { loginToThePosterDb } from './theposterdb-auth';

const item = { title: 'Test Movie', year: 2001, type: 'movie' } as MediaItem;
const config = {
	providerThePosterDb: true,
	httpCacheTtlDays: 0,
	thePosterDbUsername: 'user',
	thePosterDbPassword: 'secret'
} as AppConfig;
const search =
	'<a href="https://theposterdb.com/posters/123"><strong>Test Movie</strong> (2001)</a>';
const placeholder =
	'<div class="hovereffect"><picture><img class="tpdb-poster" src="/images/defaults/missing_poster.jpg"></picture><div class="overlay" data-poster-id="123"></div></div>';
const artwork =
	'<img src="https://images.theposterdb.com/prod/public/images/posters/optimized/movies/123/poster.webp">';

beforeEach(() => {
	vi.mocked(fetchText).mockReset();
	vi.mocked(loginToThePosterDb).mockReset();
	invalidateThePosterDbSession();
});

describe('ThePosterDB discovery failure signals', () => {
	it('reports a configured login failure rather than silently falling back to anonymous', async () => {
		vi.mocked(loginToThePosterDb).mockRejectedValue(
			new ThePosterDbAuthError('ThePosterDB rejected the username or password.')
		);
		await expect(thePosterDbProvider.discover(item, config)).rejects.toMatchObject({
			code: 'theposterdb_auth_failed'
		});
	});

	it('retries once then reports placeholder-only poster cards after a session refresh', async () => {
		vi.mocked(loginToThePosterDb)
			.mockResolvedValueOnce('session=first')
			.mockResolvedValueOnce('session=second');
		vi.mocked(fetchText)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(placeholder)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(placeholder);
		await expect(thePosterDbProvider.discover(item, config)).rejects.toMatchObject({
			code: 'theposterdb_placeholder_only'
		});
		expect(fetchText).toHaveBeenCalledTimes(4);
		expect(vi.mocked(fetchText).mock.calls[2][1]).toMatchObject({
			forceRefresh: true,
			headers: { Cookie: 'session=second' }
		});
	});

	it('retains the first placeholder failure if refresh returns no matching title', async () => {
		vi.mocked(loginToThePosterDb)
			.mockResolvedValueOnce('session=first')
			.mockResolvedValueOnce('session=second');
		vi.mocked(fetchText)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(placeholder)
			.mockResolvedValueOnce('<html>no matching titles</html>');
		await expect(thePosterDbProvider.discover(item, config)).rejects.toMatchObject({
			code: 'theposterdb_placeholder_only'
		});
	});

	it('recovers if refreshed session yields actual images despite placeholder fallback tags', async () => {
		vi.mocked(loginToThePosterDb)
			.mockResolvedValueOnce('session=first')
			.mockResolvedValueOnce('session=second');
		vi.mocked(fetchText)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(placeholder)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(placeholder + artwork);
		const result = await thePosterDbProvider.discover(item, config);
		expect(Array.isArray(result) && result.flatMap((s) => s.candidates).map((c) => c.url)).toEqual([
			'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/123/poster.webp'
		]);
	});

	it('reports an anonymous placeholder-only page but preserves no-match and empty title pages', async () => {
		const anonymous = { ...config, thePosterDbUsername: null, thePosterDbPassword: null };
		vi.mocked(fetchText)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(placeholder)
			.mockResolvedValueOnce('<html>no matching titles</html>')
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce('<html>no posters</html>');
		await expect(thePosterDbProvider.discover(item, anonymous)).rejects.toMatchObject({
			code: 'theposterdb_placeholder_only'
		});
		await expect(thePosterDbProvider.discover(item, anonymous)).resolves.toEqual([]);
		await expect(thePosterDbProvider.discover(item, anonymous)).resolves.toEqual([]);
	});

	it('keeps a no-match empty even when the retry login fails', async () => {
		vi.mocked(loginToThePosterDb)
			.mockResolvedValueOnce('session=first')
			.mockRejectedValueOnce(new ThePosterDbAuthError('rejected'));
		vi.mocked(fetchText).mockResolvedValue('<html>no matching titles</html>');
		await expect(thePosterDbProvider.discover(item, config)).resolves.toEqual([]);
	});

	it('does not combine an unrelated fallback image and poster id into a failure', async () => {
		const anonymous = { ...config, thePosterDbUsername: null, thePosterDbPassword: null };
		vi.mocked(fetchText)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(
				'<img src="/images/defaults/missing_poster.jpg"><div>unrelated content</div><div data-poster-id="123"></div>'
			);
		await expect(thePosterDbProvider.discover(item, anonymous)).resolves.toEqual([]);
	});

	it('does not treat an image fallback on a poster-less non-card page as failure', async () => {
		vi.mocked(loginToThePosterDb).mockResolvedValue('session=first');
		vi.mocked(fetchText)
			.mockResolvedValue(search)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce('<img src="/images/defaults/missing_poster.jpg">');
		await expect(thePosterDbProvider.discover(item, config)).resolves.toEqual([]);
	});

	it('fails explicitly on a Cloudflare challenge without changing mismatch handling', async () => {
		vi.mocked(loginToThePosterDb).mockResolvedValue('session=first');
		vi.mocked(fetchText).mockResolvedValue(
			'<form id="challenge-form" action="/cdn-cgi/challenge-platform/x"></form>'
		);
		await expect(thePosterDbProvider.discover(item, config)).rejects.toMatchObject({
			code: 'theposterdb_blocked'
		});
	});
});

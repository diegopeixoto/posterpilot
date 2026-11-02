import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverCandidates } from './scraper';

vi.mock('$lib/server/http', () => ({ fetchText: vi.fn() }));
import { fetchText } from '$lib/server/http';

const options = { cacheTtlDays: 0 };
const page = (rsc: string) =>
	`<html><script>self.__next_f.push([1,${JSON.stringify(rsc)}])</script></html>`;

beforeEach(() => vi.mocked(fetchText).mockReset());

describe('MediUX discovery failure signals', () => {
	it('fails for an explicit Cloudflare challenge instead of returning empty', async () => {
		vi.mocked(fetchText).mockResolvedValue(
			'<html><form id="challenge-form" action="/cdn-cgi/challenge-platform/x"></form></html>'
		);
		await expect(discoverCandidates('584', 'movie', options)).rejects.toMatchObject({
			code: 'mediux_blocked'
		});
	});

	it('does not flag a commented-out Cloudflare challenge form', async () => {
		vi.mocked(fetchText).mockResolvedValue(
			'<!-- <form id="challenge-form" action="/cdn-cgi/challenge-platform/x"></form> -->'
		);
		await expect(discoverCandidates('584', 'movie', options)).resolves.toEqual([]);
	});

	it('fails when RSC chunks are present but none can be decoded', async () => {
		vi.mocked(fetchText).mockResolvedValue(
			'<html><script>self.__next_f.push([1,"bad\\q"])</script></html>'
		);
		await expect(discoverCandidates('584', 'movie', options)).rejects.toMatchObject({
			code: 'mediux_payload_unreadable'
		});
	});

	it('does not flag RSC chunks in an HTML comment as malformed', async () => {
		vi.mocked(fetchText).mockResolvedValue(
			'<html><!-- self.__next_f.push([1,"bad\\q"]) --></html>'
		);
		await expect(discoverCandidates('584', 'movie', options)).resolves.toEqual([]);
	});

	it('does not call valid RSC with changed whitespace malformed', async () => {
		vi.mocked(fetchText).mockResolvedValue(
			'<script>self.__next_f.push([1, "valid payload"])</script>'
		);
		await expect(discoverCandidates('584', 'movie', options)).resolves.toEqual([]);
	});

	it('keeps a legitimate empty RSC chunk empty', async () => {
		vi.mocked(fetchText).mockResolvedValue(page(''));
		await expect(discoverCandidates('584', 'movie', options)).resolves.toEqual([]);
	});

	it('preserves genuinely empty and unrecognized pages as empty', async () => {
		vi.mocked(fetchText)
			.mockResolvedValueOnce(page('"movie":{"id":"584","title":"Test"},"sets":[]'))
			.mockResolvedValueOnce('<html>not found</html>');
		await expect(discoverCandidates('584', 'movie', options)).resolves.toEqual([]);
		await expect(discoverCandidates('584', 'movie', options)).resolves.toEqual([]);
	});

	it('still discovers artwork from a valid RSC response', async () => {
		vi.mocked(fetchText).mockResolvedValue(
			page(
				'"movie":{"id":"584","title":"Test"},"sets":[{"id":"10","set_name":"Test Set","files":[{"set_id":{"id":"10"},"id":"11111111-1111-1111-1111-111111111111","filename_disk":"a.jpg","title":"Test (2001)","fileType":"poster"}]}]'
			)
		);
		const sets = await discoverCandidates('584', 'movie', options);
		expect(sets.flatMap((set) => set.candidates).map((c) => c.providerAssetId)).toEqual([
			'11111111-1111-1111-1111-111111111111'
		]);
	});
});

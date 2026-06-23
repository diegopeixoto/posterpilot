import { describe, it, expect } from 'vitest';
import { decodeRscPayload, parseListingSets } from './parser';

/**
 * Build a mediux.pro-style page from a raw RSC payload string. mediux emits the
 * payload as `self.__next_f.push([1,"<escaped>"])` chunks; JSON.stringify produces
 * exactly that escaping, and the parser decodes it back.
 */
function page(rsc: string): string {
	return `<!doctype html><script>self.__next_f.push([1,${JSON.stringify(rsc)}])</script>`;
}

function file(setId: string, uuid: string, title: string, fileType: string): string {
	return `{"set_id":{"id":"${setId}","posterCheck":[]},"id":"${uuid}","filename_disk":"${uuid}.jpg","title":"${title}","fileType":"${fileType}"}`;
}

const P = '11111111-1111-1111-1111-111111111111'; // poster
const B = '22222222-2222-2222-2222-222222222222'; // backdrop
const S = '33333333-3333-3333-3333-333333333333'; // season poster
const T = '44444444-4444-4444-4444-444444444444'; // title card
const M = '55555555-5555-5555-5555-555555555555'; // misc (skipped)
const C = '66666666-6666-6666-6666-666666666666'; // collection poster (excluded)

const rsc =
	`"sets":[{"id":"8472","set_name":"Test Movie (2003) Set","files":[` +
	`${file('8472', P, 'Test Movie (2003)', 'poster')},` +
	`${file('8472', B, 'Test Movie (2003)', 'backdrop')},` +
	`${file('8472', S, 'Test Show Season 2', 'poster')},` +
	`${file('8472', T, 'Test Show S01E03', 'title_card')},` +
	`${file('8472', M, 'Test Movie (2003)', 'misc')}` +
	`]}],` +
	`"id":"1481","set_name":"Test Collection","files":[${file('1481', C, 'Other Movie', 'poster')}]`;

describe('decodeRscPayload', () => {
	it('returns empty string when no payload chunks exist', () => {
		expect(decodeRscPayload('<html><body>no payload</body></html>')).toBe('');
	});
});

describe('parseListingSets', () => {
	const sets = parseListingSets(page(rsc));
	const all = sets.flatMap((s) => s.candidates);

	it('drops collection sets (sibling-title artwork)', () => {
		expect(sets.map((s) => s.setId)).toEqual(['8472']);
		expect(all.some((c) => c.url.includes(C))) .toBe(false);
	});

	it('builds api.mediux.pro asset URLs and classifies kinds', () => {
		const poster = all.find((c) => c.url.endsWith(P));
		expect(poster).toEqual({
			setId: '8472',
			url: `https://api.mediux.pro/assets/${P}`,
			kind: 'poster',
			season: null,
			episode: null
		});
		expect(all.find((c) => c.url.endsWith(B))?.kind).toBe('background');
	});

	it('detects season posters and title cards from the title', () => {
		expect(all.find((c) => c.url.endsWith(S))).toMatchObject({ kind: 'season', season: 2 });
		expect(all.find((c) => c.url.endsWith(T))).toMatchObject({
			kind: 'title_card',
			season: 1,
			episode: 3
		});
	});

	it('skips non-cover files (misc/album_art) and unparseable pages', () => {
		expect(all.some((c) => c.url.includes(M))).toBe(false);
		expect(parseListingSets('<html>nothing</html>')).toEqual([]);
	});
});

import { describe, it, expect } from 'vitest';
import {
	decodeRscPayload,
	extractSetAuthors,
	parseListingSets,
	titleMatchesTarget
} from './parser';

/** Wrap a raw RSC payload the way mediux emits it (a self.__next_f.push chunk). */
function page(rsc: string): string {
	return `<!doctype html><script>self.__next_f.push([1,${JSON.stringify(rsc)}])</script>`;
}

function file(setId: string, uuid: string, title: string, fileType: string): string {
	return `{"set_id":{"id":"${setId}","posterCheck":[]},"id":"${uuid}","filename_disk":"${uuid}.jpg","title":"${title}","fileType":"${fileType}"}`;
}

const P = '11111111-1111-1111-1111-111111111111'; // target poster
const B = '22222222-2222-2222-2222-222222222222'; // target backdrop
const X = '33333333-3333-3333-3333-333333333333'; // franchise sibling poster (dropped)
const M = '44444444-4444-4444-4444-444444444444'; // misc (dropped)

const rsc =
	`"movie":{"id":"584","title":"Test Movie","tagline":"x"},` +
	`"sets":[{"id":"8472","set_name":"Test Movie Set","user_created":{"username":"poster_maker"},"files":[` +
	`${file('8472', P, 'Test Movie (2003)', 'poster')},` +
	`${file('8472', B, 'Test Movie (2003)', 'backdrop')},` +
	`${file('8472', X, 'Other Movie 6 (2013)', 'poster')},` +
	`${file('8472', M, 'Test Movie (2003)', 'misc')}` +
	`]}]`;

describe('titleMatchesTarget', () => {
	it('matches a movie by title sans year', () => {
		expect(titleMatchesTarget('Test Movie (2003)', 'Test Movie')).toBe(true);
	});
	it('rejects franchise siblings (exact title sans year)', () => {
		expect(titleMatchesTarget('Other Movie 6 (2013)', 'Other Movie')).toBe(false);
		expect(titleMatchesTarget('The Fast and the Furious (2001)', '2 Fast 2 Furious')).toBe(false);
	});
	it('matches TV files (no year) by prefix', () => {
		expect(titleMatchesTarget('Breaking Bad S01E03', 'Breaking Bad')).toBe(true);
		expect(titleMatchesTarget('Breaking Bad Season 2', 'Breaking Bad')).toBe(true);
	});
	it('does not filter when the target is unknown', () => {
		expect(titleMatchesTarget('Anything', null)).toBe(true);
	});
});

describe('decodeRscPayload', () => {
	it('returns empty string when no payload chunks exist', () => {
		expect(decodeRscPayload('<html>no payload</html>')).toBe('');
	});
});

describe('parseListingSets', () => {
	const sets = parseListingSets(page(rsc), '584', 'movie');
	const all = sets.flatMap((s) => s.candidates);

	it('keeps only the target item’s covers and builds asset URLs', () => {
		expect(sets.map((s) => s.setId)).toEqual(['8472']);
		const poster = all.find((c) => c.url.endsWith(P));
		expect(poster).toEqual({
			setId: '8472',
			setAuthor: 'poster_maker',
			url: `https://api.mediux.pro/assets/${P}`,
			kind: 'poster',
			season: null,
			episode: null
		});
		expect(all.find((c) => c.url.endsWith(B))?.kind).toBe('background');
	});

	it('drops franchise siblings and non-cover files', () => {
		expect(all.some((c) => c.url.includes(X))).toBe(false); // "Other Movie 6"
		expect(all.some((c) => c.url.includes(M))).toBe(false); // misc
		expect(all).toHaveLength(2);
	});

	it('returns [] for an unparseable page', () => {
		expect(parseListingSets('<html>nothing</html>', '584', 'movie')).toEqual([]);
	});

	it('attaches the set author to every candidate in the set', () => {
		expect(all.every((c) => c.setAuthor === 'poster_maker')).toBe(true);
		expect(sets[0].author).toBe('poster_maker');
	});
});

describe('extractSetAuthors', () => {
	it('maps a set id to its uploader username', () => {
		const rscA = `"sets":[{"id":"100","set_name":"Alice Set","user_created":{"username":"alice"},"files":[]}]`;
		expect(extractSetAuthors(rscA).get('100')).toBe('alice');
	});

	it('omits sets that have no identifiable author', () => {
		const rscB = `"sets":[{"id":"101","set_name":"No Author","files":[]}]`;
		expect(extractSetAuthors(rscB).has('101')).toBe(false);
	});

	it('maps multiple sets independently', () => {
		const rscC =
			`"sets":[` +
			`{"id":"200","set_name":"A","user_created":{"username":"bob"},"files":[]},` +
			`{"id":"201","set_name":"B","user_created":{"username":"carol"},"files":[]}` +
			`]`;
		const m = extractSetAuthors(rscC);
		expect(m.get('200')).toBe('bob');
		expect(m.get('201')).toBe('carol');
	});

	it('never throws on malformed input', () => {
		expect(() => extractSetAuthors('garbage {{{')).not.toThrow();
		expect(extractSetAuthors('garbage {{{').size).toBe(0);
	});
});

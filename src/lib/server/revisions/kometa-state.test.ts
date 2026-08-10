import { describe, expect, it } from 'vitest';
import { isMap, parseDocument } from 'yaml';
import { readKometaSlot, restoreKometaSlot, verifyKometaSlot } from './kometa-state';

const rootPoster = { kind: 'poster' as const, season: null, episode: null };
const titleCard = { kind: 'title_card' as const, season: 1, episode: 2 };

describe('Kometa managed slot state', () => {
	it('distinguishes a present scalar from absence', () => {
		const raw = 'metadata:\n  10:\n    url_poster: old.jpg\n';
		expect(readKometaSlot(raw, '10', rootPoster)).toEqual({ state: 'present', url: 'old.jpg' });
		expect(readKometaSlot(raw, '11', rootPoster)).toEqual({ state: 'absent', url: null });
	});

	it('restores one slot without disturbing sibling values or comments', () => {
		const raw = [
			'# keep this comment',
			'metadata:',
			'  "10":',
			'    url_poster: new.jpg',
			'    url_background: keep.jpg',
			'    custom_key: keep-me',
			''
		].join('\n');
		const restored = restoreKometaSlot(raw, '10', rootPoster, {
			state: 'present',
			url: 'old.jpg'
		});
		expect(restored).toContain('# keep this comment');
		expect(restored).toContain('url_poster: old.jpg');
		expect(restored).toContain('url_background: keep.jpg');
		expect(restored).toContain('custom_key: keep-me');
	});

	it('creates an absent numeric mapping as an unquoted YAML integer', () => {
		const restored = restoreKometaSlot('', 101, rootPoster, {
			state: 'present',
			url: 'https://images.invalid/prior.jpg'
		});

		expect(restored).toContain('101:');
		expect(restored).not.toContain('"101":');
		expect(readKometaSlot(restored, 101, rootPoster)).toEqual({
			state: 'present',
			url: 'https://images.invalid/prior.jpg'
		});
	});

	it('accepts an explicit YAML null root as an empty document', () => {
		expect(readKometaSlot('null\n', 101, rootPoster)).toEqual({ state: 'absent', url: null });
		const restored = restoreKometaSlot('null\n', 101, rootPoster, {
			state: 'present',
			url: 'https://images.invalid/from-null.jpg'
		});
		expect(readKometaSlot(restored, 101, rootPoster)).toEqual({
			state: 'present',
			url: 'https://images.invalid/from-null.jpg'
		});
	});

	it('creates numeric season and episode identifiers as nested mappings', () => {
		const restored = restoreKometaSlot('', 101, titleCard, {
			state: 'present',
			url: 'https://images.invalid/title-card.jpg'
		});
		const document = parseDocument(restored);

		expect(isMap(document.getIn(['metadata'], true))).toBe(true);
		expect(isMap(document.getIn(['metadata', 101], true))).toBe(true);
		expect(isMap(document.getIn(['metadata', 101, 'seasons'], true))).toBe(true);
		expect(isMap(document.getIn(['metadata', 101, 'seasons', 1], true))).toBe(true);
		expect(isMap(document.getIn(['metadata', 101, 'seasons', 1, 'episodes'], true))).toBe(true);
		expect(isMap(document.getIn(['metadata', 101, 'seasons', 1, 'episodes', 2], true))).toBe(true);
		expect(readKometaSlot(restored, 101, titleCard)).toEqual({
			state: 'present',
			url: 'https://images.invalid/title-card.jpg'
		});
	});

	it.each([
		[
			'metadata identifiers',
			'metadata:\n  101:\n    url_poster: first.jpg\n  "101":\n    url_poster: second.jpg\n',
			rootPoster
		],
		[
			'season identifiers',
			'metadata:\n  101:\n    seasons:\n      1:\n        episodes:\n          2:\n            url_poster: first.jpg\n      "1":\n        episodes:\n          2:\n            url_poster: second.jpg\n',
			titleCard
		]
	] as const)('rejects logically duplicate %s', (_label, raw, slot) => {
		expect(() => readKometaSlot(raw, 101, slot)).toThrow('Ambiguous existing Kometa YAML keys');
		expect(() =>
			restoreKometaSlot(raw, 101, slot, {
				state: 'present',
				url: 'https://images.invalid/replacement.jpg'
			})
		).toThrow('Ambiguous existing Kometa YAML keys');
	});

	it.each([
		['root', 'keep-this-root\n', rootPoster],
		['metadata', 'metadata: keep-this-metadata\n', rootPoster],
		['item', 'metadata:\n  101: keep-this-item\n', rootPoster],
		['seasons', 'metadata:\n  101:\n    seasons: keep-these-seasons\n', titleCard],
		[
			'episodes',
			'metadata:\n  101:\n    seasons:\n      1:\n        episodes: keep-these-episodes\n',
			titleCard
		]
	] as const)('fails closed for an incompatible %s node', (_label, raw, slot) => {
		expect(() => readKometaSlot(raw, 101, slot)).toThrow(/not a mapping/);
		expect(() => verifyKometaSlot(raw, 101, slot, { state: 'absent', url: null })).toThrow(
			/not a mapping/
		);
		expect(() =>
			restoreKometaSlot(raw, 101, slot, {
				state: 'present',
				url: 'https://images.invalid/replacement.jpg'
			})
		).toThrow(/not a mapping/);
		expect(() => restoreKometaSlot(raw, 101, slot, { state: 'absent', url: null })).toThrow(
			/not a mapping/
		);
	});

	it('fails closed when a managed URL slot is a collection', () => {
		const raw = 'metadata:\n  101:\n    url_poster:\n      nested: keep-this\n';
		expect(() => readKometaSlot(raw, 101, rootPoster)).toThrow(/not a string scalar/);
		expect(() => verifyKometaSlot(raw, 101, rootPoster, { state: 'absent', url: null })).toThrow(
			/not a string scalar/
		);
	});

	it('replaces an explicitly tagged scalar with a clean string node', () => {
		// Swapping only the value on a `!!int` scalar would keep the tag and
		// serialize the URL under the wrong type; the node itself is replaced.
		const raw = 'metadata:\n  101:\n    url_poster: !!int 123\n';
		const restored = restoreKometaSlot(raw, 101, rootPoster, {
			state: 'present',
			url: 'https://images.invalid/replacement.jpg'
		});
		expect(restored).not.toContain('!!int');
		expect(readKometaSlot(restored, 101, rootPoster)).toEqual({
			state: 'present',
			url: 'https://images.invalid/replacement.jpg'
		});
	});

	it('treats a non-string scalar slot as absent and lets a managed write replace it', () => {
		// An unquoted number or boolean at a managed slot is a typo, not
		// structure; failing every export over it left the entry permanently
		// unwritable while exporting nothing Kometa could use anyway.
		const raw = 'metadata:\n  101:\n    url_poster: 12345\n';
		expect(readKometaSlot(raw, 101, rootPoster)).toEqual({ state: 'absent', url: null });
		const restored = restoreKometaSlot(raw, 101, rootPoster, {
			state: 'present',
			url: 'https://images.invalid/replacement.jpg'
		});
		expect(restored).toContain('url_poster: https://images.invalid/replacement.jpg');
	});

	it('removes a newly introduced nested slot and only empty managed containers', () => {
		const raw = [
			'metadata:',
			'  "10":',
			'    url_poster: keep.jpg',
			'    seasons:',
			'      1:',
			'        episodes:',
			'          2:',
			'            url_poster: card.jpg',
			''
		].join('\n');
		const restored = restoreKometaSlot(raw, '10', titleCard, { state: 'absent', url: null });
		expect(restored).toContain('url_poster: keep.jpg');
		expect(restored).not.toContain('card.jpg');
		expect(verifyKometaSlot(restored, '10', titleCard, { state: 'absent', url: null })).toBe(true);
	});
});

import { describe, expect, it } from 'vitest';
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

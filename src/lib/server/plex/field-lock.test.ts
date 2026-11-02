import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetchJson: vi.fn() }));

vi.mock('$lib/server/http', () => ({ fetchJson: h.fetchJson }));

import { readFieldLock } from './client';

describe('Plex field lock read', () => {
	it('reads the thumb and art locks from the item Field list', async () => {
		h.fetchJson.mockResolvedValue({
			MediaContainer: {
				Metadata: [
					{
						ratingKey: '42',
						title: 'Movie',
						type: 'movie',
						Field: [
							{ name: 'thumb', locked: true },
							{ name: 'title', locked: true }
						]
					}
				]
			}
		});

		expect(await readFieldLock('http://plex:32400', 'token', '42', 'poster')).toBe(true);
		expect(await readFieldLock('http://plex:32400', 'token', '42', 'background')).toBe(false);
		expect(h.fetchJson.mock.calls[0][0]).toContain('/library/metadata/42');
	});

	it('treats an item without a Field list as unlocked', async () => {
		h.fetchJson.mockResolvedValue({
			MediaContainer: { Metadata: [{ ratingKey: '42', title: 'Movie', type: 'movie' }] }
		});

		expect(await readFieldLock('http://plex:32400', 'token', '42', 'poster')).toBe(false);
	});
});

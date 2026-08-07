import { describe, expect, it } from 'vitest';
import { isActiveTmdbRepairJob, tmdbRepairPollInterval } from './tmdb-repair-polling';

describe('TMDB repair banner polling', () => {
	it.each(['pending', 'running', 'retry_scheduled'])('polls while %s work is active', (status) => {
		expect(isActiveTmdbRepairJob(status)).toBe(true);
		expect(tmdbRepairPollInterval(4, status)).toBe(3_000);
	});

	it.each([null, 'completed', 'partial_failed', 'failed', 'cancelled', 'interrupted'])(
		'does not poll an idle or terminal warning (%s)',
		(status) => {
			expect(tmdbRepairPollInterval(4, status)).toBeNull();
		}
	);

	it('stops polling as soon as no mismatch remains', () => {
		expect(tmdbRepairPollInterval(0, 'running')).toBeNull();
	});
});

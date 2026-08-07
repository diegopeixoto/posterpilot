import { describe, expect, it, vi } from 'vitest';
import {
	createSingleFlightTmdbRepairRefresh,
	isActiveTmdbRepairJob,
	tmdbRepairPollInterval
} from './tmdb-repair-polling';

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

	it('coalesces concurrent timer and focus refreshes', async () => {
		let release!: () => void;
		const refresh = vi
			.fn<() => Promise<void>>()
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						release = resolve;
					})
			)
			.mockResolvedValueOnce(undefined);
		const run = createSingleFlightTmdbRepairRefresh(refresh);

		const timerRefresh = run();
		const focusRefresh = run();
		await Promise.resolve();

		expect(focusRefresh).toBe(timerRefresh);
		expect(refresh).toHaveBeenCalledTimes(1);
		release();
		await timerRefresh;

		await run();
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('consumes a refresh failure and lets the next tick retry', async () => {
		const refresh = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error('temporary load failure'))
			.mockResolvedValueOnce(undefined);
		const run = createSingleFlightTmdbRepairRefresh(refresh);

		await expect(run()).resolves.toBeUndefined();
		await expect(run()).resolves.toBeUndefined();
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});

import { describe, expect, it, vi } from 'vitest';
import {
	createSingleFlightTmdbRepairRefresh,
	isActiveTmdbRepairJob,
	observeTmdbRepairVisibility,
	type TmdbRepairVisibilitySource,
	tmdbRepairPollInterval
} from './tmdb-repair-polling';

function createVisibilityHarness(initialState: string) {
	let visibilityState = initialState;
	let listener: (() => void) | null = null;
	const source: TmdbRepairVisibilitySource = {
		get visibilityState() {
			return visibilityState;
		},
		addEventListener: vi.fn((_type, nextListener) => {
			listener = nextListener;
		}),
		removeEventListener: vi.fn((_type, currentListener) => {
			if (listener === currentListener) listener = null;
		})
	};

	return {
		source,
		setState(nextState: string) {
			visibilityState = nextState;
		},
		dispatch() {
			listener?.();
		}
	};
}

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

	it('coalesces concurrent timer and visibility refreshes', async () => {
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
		const visibility = createVisibilityHarness('hidden');
		const stopObserving = observeTmdbRepairVisibility(visibility.source, run);

		const timerRefresh = run();
		visibility.setState('visible');
		visibility.dispatch();
		await Promise.resolve();

		expect(refresh).toHaveBeenCalledTimes(1);
		release();
		await timerRefresh;

		visibility.setState('hidden');
		visibility.dispatch();
		visibility.setState('visible');
		visibility.dispatch();
		await Promise.resolve();
		await run();
		expect(refresh).toHaveBeenCalledTimes(2);
		stopObserving();
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

	it('refreshes once only after a hidden document becomes visible', async () => {
		const visibility = createVisibilityHarness('visible');
		const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const stopObserving = observeTmdbRepairVisibility(visibility.source, refresh);

		visibility.dispatch();
		visibility.setState('prerender');
		visibility.dispatch();
		visibility.setState('hidden');
		visibility.dispatch();
		expect(refresh).not.toHaveBeenCalled();

		visibility.setState('visible');
		visibility.dispatch();
		visibility.dispatch();
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(1);

		visibility.setState('hidden');
		visibility.dispatch();
		visibility.setState('visible');
		visibility.dispatch();
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(2);
		stopObserving();
	});

	it('arms an initially hidden document and removes its listener on cleanup', async () => {
		const visibility = createVisibilityHarness('hidden');
		const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const stopObserving = observeTmdbRepairVisibility(visibility.source, refresh);

		visibility.setState('visible');
		visibility.dispatch();
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(1);

		stopObserving();
		visibility.setState('hidden');
		visibility.dispatch();
		visibility.setState('visible');
		visibility.dispatch();
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(visibility.source.removeEventListener).toHaveBeenCalledTimes(1);
	});
});

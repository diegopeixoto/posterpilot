import { describe, expect, it, vi } from 'vitest';
import {
	createSingleFlightTmdbRepairRefresh,
	isActiveTmdbRepairJob,
	observeTmdbRepairVisibility,
	observeTmdbRepairWakeSignals,
	type TmdbRepairFocusSource,
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

function createFocusHarness() {
	let focused = false;
	let listener: (() => void) | null = null;
	const source: TmdbRepairFocusSource = {
		addEventListener: vi.fn((_type, nextListener) => {
			listener = nextListener;
		}),
		removeEventListener: vi.fn((_type, currentListener) => {
			if (listener === currentListener) listener = null;
		})
	};

	return {
		source,
		blur() {
			focused = false;
		},
		focus() {
			if (focused) return;
			focused = true;
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
		'ticks an idle or terminal warning slowly (%s), so a focused tab still converges',
		(status) => {
			expect(tmdbRepairPollInterval(4, status)).toBe(60_000);
		}
	);

	it('stops polling as soon as no mismatch remains', () => {
		expect(tmdbRepairPollInterval(0, 'running')).toBeNull();
	});

	it('coalesces concurrent timer, visibility, and focus refreshes', async () => {
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
		const focus = createFocusHarness();
		const stopObserving = observeTmdbRepairWakeSignals(visibility.source, focus.source, run);

		const timerRefresh = run();
		visibility.setState('visible');
		visibility.dispatch();
		focus.focus();
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

	it('refreshes when a visible window regains focus without a visibility transition', async () => {
		const visibility = createVisibilityHarness('visible');
		const focus = createFocusHarness();
		const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const stopObserving = observeTmdbRepairWakeSignals(visibility.source, focus.source, refresh);

		focus.blur();
		focus.focus();
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(1);

		visibility.setState('hidden');
		visibility.dispatch();
		focus.blur();
		focus.focus();
		expect(refresh).toHaveBeenCalledTimes(1);

		stopObserving();
		visibility.setState('visible');
		visibility.dispatch();
		focus.blur();
		focus.focus();
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(visibility.source.removeEventListener).toHaveBeenCalledTimes(1);
		expect(focus.source.removeEventListener).toHaveBeenCalledTimes(1);
	});
});

const ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'retry_scheduled']);

export type TmdbRepairRefresh = () => Promise<void>;

export type TmdbRepairVisibilitySource = {
	readonly visibilityState: string;
	addEventListener(type: 'visibilitychange', listener: () => void): void;
	removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type TmdbRepairFocusSource = {
	addEventListener(type: 'focus', listener: () => void): void;
	removeEventListener(type: 'focus', listener: () => void): void;
};

export function isActiveTmdbRepairJob(status: string | null | undefined): boolean {
	return status !== null && status !== undefined && ACTIVE_JOB_STATUSES.has(status);
}

/**
 * Idle repair warnings must not create fast permanent root-layout polling —
 * but they must still notice work done elsewhere. A focused, visible window
 * fires no visibility or focus event, so with no timer at all a banner whose
 * mismatches were fixed in another tab or device would claim pending work
 * indefinitely. An active job polls near-live; an idle warning ticks slowly.
 */
export function tmdbRepairPollInterval(
	pendingCount: number,
	status: string | null | undefined
): number | null {
	if (pendingCount <= 0) return null;
	return isActiveTmdbRepairJob(status) ? 3_000 : 60_000;
}

/**
 * Coalesce timer and visibility refreshes into one invalidation. Background refresh failures are
 * intentionally consumed so a later tick can retry without producing an unhandled rejection.
 */
export function createSingleFlightTmdbRepairRefresh(
	refresh: () => Promise<void>
): TmdbRepairRefresh {
	let inFlight: Promise<void> | null = null;
	return () => {
		if (inFlight) return inFlight;
		const current = Promise.resolve()
			.then(refresh)
			.catch(() => undefined)
			.finally(() => {
				if (inFlight === current) inFlight = null;
			});
		inFlight = current;
		return current;
	};
}

/**
 * Refresh once for each hidden-to-visible transition. Tracking the transition avoids route
 * invalidation for a synthetic visibility event while the document is already visible.
 */
export function observeTmdbRepairVisibility(
	source: TmdbRepairVisibilitySource,
	refresh: TmdbRepairRefresh
): () => void {
	let wasHidden = source.visibilityState === 'hidden';
	const onVisibilityChange = () => {
		if (source.visibilityState === 'hidden') {
			wasHidden = true;
			return;
		}
		if (source.visibilityState !== 'visible' || !wasHidden) return;
		wasHidden = false;
		void refresh();
	};

	source.addEventListener('visibilitychange', onVisibilityChange);
	return () => source.removeEventListener('visibilitychange', onVisibilityChange);
}

/**
 * Observe both browser wake signals. Focus remains useful for a visible window that never changed
 * document visibility; the shared refresh coalesces it with visibility and timer signals.
 */
export function observeTmdbRepairWakeSignals(
	visibilitySource: TmdbRepairVisibilitySource,
	focusSource: TmdbRepairFocusSource,
	refresh: TmdbRepairRefresh
): () => void {
	const stopVisibility = observeTmdbRepairVisibility(visibilitySource, refresh);
	const onFocus = () => {
		if (visibilitySource.visibilityState === 'visible') void refresh();
	};
	focusSource.addEventListener('focus', onFocus);

	return () => {
		stopVisibility();
		focusSource.removeEventListener('focus', onFocus);
	};
}

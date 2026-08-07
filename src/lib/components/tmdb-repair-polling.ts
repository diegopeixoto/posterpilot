const ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'retry_scheduled']);

export type TmdbRepairRefresh = () => Promise<void>;

export function isActiveTmdbRepairJob(status: string | null | undefined): boolean {
	return status !== null && status !== undefined && ACTIVE_JOB_STATUSES.has(status);
}

/** Idle repair warnings must not create permanent root-layout polling. */
export function tmdbRepairPollInterval(
	pendingCount: number,
	status: string | null | undefined
): number | null {
	return pendingCount > 0 && isActiveTmdbRepairJob(status) ? 3_000 : null;
}

/**
 * Coalesce timer and focus refreshes into one invalidation. Background refresh failures are
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

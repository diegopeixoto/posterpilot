const ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'retry_scheduled']);

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

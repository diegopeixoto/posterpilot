import type { PublicJobProgress } from '$lib/job-progress';

export const JOB_SSE_RETRY_MS = 2_000;
export const JOB_SSE_KEEPALIVE_MS = 15_000;

function updatedAtMillis(value: Date | string): number {
	const millis = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isFinite(millis) ? Math.max(0, millis) : 0;
}

export function jobSseRetryDirective(): string {
	return `retry: ${JOB_SSE_RETRY_MS}\n\n`;
}

export function jobSseSnapshot(progress: PublicJobProgress): string {
	const eventId = `${progress.jobId}-${updatedAtMillis(progress.updatedAt)}`;
	return `id: ${eventId}\ndata: ${JSON.stringify(progress)}\n\n`;
}

export function jobSseKeepalive(at = Date.now()): string {
	return `: keepalive ${Math.max(0, Math.trunc(at))}\n\n`;
}

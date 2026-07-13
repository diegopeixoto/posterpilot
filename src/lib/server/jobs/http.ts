import { json } from '@sveltejs/kit';

/** Convert only known durable-enqueue conflicts into a credentials-safe API response. */
export function jobEnqueueErrorResponse(error: unknown): Response | null {
	if (!error || typeof error !== 'object') return null;
	const record = error as Record<string, unknown>;
	if (
		record.code !== 'job_conflict' ||
		!Number.isSafeInteger(record.conflictingJobId) ||
		Number(record.conflictingJobId) <= 0
	) {
		return null;
	}
	return json(
		{
			error: {
				code: 'job_conflict',
				conflictingJobId: Number(record.conflictingJobId),
				...(typeof record.conflictingJobType === 'string'
					? { conflictingJobType: record.conflictingJobType }
					: {})
			}
		},
		{ status: 409 }
	);
}

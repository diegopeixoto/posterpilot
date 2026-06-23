import { describe, it, expect } from 'vitest';
import { emitProgress, onProgress, onAnyProgress, type JobProgress } from './events';

const mk = (jobId: number, status = 'running'): JobProgress => ({
	jobId,
	processed: 1,
	total: 2,
	currentItem: 'x',
	status
});

describe('job progress bus', () => {
	it('delivers only matching-job events and stops after unsubscribe', () => {
		const got: JobProgress[] = [];
		const off = onProgress(7, (p) => got.push(p));
		emitProgress(mk(7));
		emitProgress(mk(8)); // different job — must not be delivered
		off();
		emitProgress(mk(7)); // after unsubscribe — must not be delivered
		expect(got).toHaveLength(1);
		expect(got[0].jobId).toBe(7);
	});

	it('delivers events from any job to the global subscriber', () => {
		const got: number[] = [];
		const off = onAnyProgress((p) => got.push(p.jobId));
		emitProgress(mk(1));
		emitProgress(mk(2));
		off();
		emitProgress(mk(3));
		expect(got).toEqual([1, 2]);
	});
});

import type { RequestHandler } from './$types';
import { onProgress } from '$lib/server/jobs/events';
import { getJob } from '$lib/server/queries';
import { error } from '@sveltejs/kit';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { isTerminalJobStatus } from '$lib/job-progress';
import {
	JOB_SSE_KEEPALIVE_MS,
	jobSseKeepalive,
	jobSseRetryDirective,
	jobSseSnapshot
} from '$lib/server/jobs/sse';

/** Server-Sent Events stream of a single job's progress (snapshot, then live). */
export const GET: RequestHandler = async ({ params, request }) => {
	const jobId = Number(params.id);
	const active = await getActiveServerInstance();
	if (!active || !Number.isSafeInteger(jobId)) throw error(404, 'job not found');
	const initialJob = await getJob(jobId, active.id);
	if (!initialJob) throw error(404, 'job not found');
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;
	let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
	let removeAbortListener: (() => void) | null = null;
	let closed = false;
	let refreshQueue = Promise.resolve();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const cleanup = () => {
				unsubscribe?.();
				unsubscribe = null;
				if (keepaliveTimer) clearInterval(keepaliveTimer);
				keepaliveTimer = null;
				removeAbortListener?.();
				removeAbortListener = null;
			};
			const enqueue = (value: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(value));
				} catch {
					closed = true;
					cleanup();
				}
			};
			const close = () => {
				if (closed) return;
				closed = true;
				cleanup();
				try {
					controller.close();
				} catch {
					// The client may have cancelled between the last enqueue and close.
				}
			};
			const refresh = () => {
				refreshQueue = refreshQueue
					.then(async () => {
						if (closed) return;
						const job = await getJob(jobId, active.id);
						if (!job) {
							close();
							return;
						}
						enqueue(jobSseSnapshot(job));
						if (isTerminalJobStatus(job.status)) close();
					})
					.catch(close);
			};

			enqueue(jobSseRetryDirective());
			// Subscribe before the second durable read so a transition between route
			// authorization and stream startup cannot be lost.
			unsubscribe = onProgress(jobId, refresh);
			keepaliveTimer = setInterval(() => enqueue(jobSseKeepalive()), JOB_SSE_KEEPALIVE_MS);
			(keepaliveTimer as unknown as { unref?: () => void }).unref?.();
			const abort = () => close();
			request.signal.addEventListener('abort', abort, { once: true });
			removeAbortListener = () => request.signal.removeEventListener('abort', abort);
			if (request.signal.aborted) close();
			else refresh();
		},
		cancel() {
			closed = true;
			unsubscribe?.();
			unsubscribe = null;
			if (keepaliveTimer) clearInterval(keepaliveTimer);
			keepaliveTimer = null;
			removeAbortListener?.();
			removeAbortListener = null;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};

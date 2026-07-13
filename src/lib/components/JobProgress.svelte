<script lang="ts">
	import JobDetails from '$lib/components/JobDetails.svelte';
	import type { PublicJobProgress } from '$lib/job-progress';
	import { isTerminalJobStatus } from '$lib/job-progress';
	import { jobPhaseLabel, jobStatusLabel } from '$lib/job-labels';
	import { m } from '$lib/paraglide/messages';

	let {
		jobId,
		onDone,
		onRetryStarted
	}: {
		jobId: number;
		onDone?: (status: string, progress: PublicJobProgress) => void;
		onRetryStarted?: (jobIds: number[]) => void;
	} = $props();

	function emptyProgress(id: number): PublicJobProgress {
		const now = new Date();
		return {
			id,
			jobId: id,
			serverInstanceId: null,
			librarySectionKey: null,
			type: 'unknown',
			status: 'pending',
			phase: null,
			processed: 0,
			total: 0,
			currentItem: null,
			attempt: 0,
			maxAttempts: 0,
			resultSummary: { succeeded: 0, failed: 0, skipped: 0, interrupted: 0 },
			error: null,
			failureCount: 0,
			retryableFailedCount: 0,
			failures: [],
			hiddenFailureCount: 0,
			createdAt: now,
			startedAt: null,
			finishedAt: null,
			updatedAt: now
		};
	}

	let progress = $state<PublicJobProgress>(emptyProgress(0));
	let connection = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
	let cancelling = $state(false);
	let cancelError = $state<string | null>(null);

	$effect(() => {
		const trackedJobId = jobId;
		progress = emptyProgress(trackedJobId);
		connection = 'connecting';
		cancelError = null;
		let notified = false;
		const es = new EventSource(`/api/jobs/${trackedJobId}/stream`);
		es.onopen = () => {
			connection = 'live';
		};
		es.onmessage = (event) => {
			try {
				const snapshot = JSON.parse(event.data) as PublicJobProgress;
				if (snapshot.jobId !== trackedJobId) return;
				progress = snapshot;
				connection = 'live';
				if (isTerminalJobStatus(snapshot.status)) {
					es.close();
					if (!notified) {
						notified = true;
						onDone?.(snapshot.status, snapshot);
					}
				}
			} catch {
				// Ignore malformed frames; EventSource remains connected for the next
				// durable snapshot instead of replacing truthful state with an error.
			}
		};
		es.onerror = () => {
			if (!isTerminalJobStatus(progress.status)) connection = 'reconnecting';
			// Native EventSource reconnects using the server-provided retry delay.
			// Deliberately do not close here.
		};
		return () => es.close();
	});

	const pct = $derived(
		progress.total > 0
			? Math.min(100, Math.max(0, Math.round((progress.processed / progress.total) * 100)))
			: 0
	);
	const done = $derived(isTerminalJobStatus(progress.status));
	const phase = $derived(jobPhaseLabel(progress.phase, progress.status));
	const connectionLabel = $derived(
		connection === 'live'
			? m.jobs_connection_live()
			: connection === 'reconnecting'
				? m.jobs_connection_reconnecting()
				: m.jobs_connection_connecting()
	);
	const hasDetails = $derived(
		done &&
			(progress.error !== null ||
				progress.failureCount > 0 ||
				Object.values(progress.resultSummary).some((count) => count > 0))
	);

	async function cancel(): Promise<void> {
		if (cancelling || done) return;
		cancelling = true;
		cancelError = null;
		try {
			const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
			if (!response.ok) cancelError = m.jobs_cancel_failed();
		} catch {
			cancelError = m.jobs_cancel_failed();
		} finally {
			cancelling = false;
		}
	}
</script>

<div class="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4" aria-busy={!done}>
	<p class="sr-only" aria-live="polite" aria-atomic="true">
		{m.jobs_progress({ id: jobId, status: jobStatusLabel(progress.status) })}.
		{m.jobs_phase({ phase })}.
		{connectionLabel}.
	</p>
	<div class="mb-2 flex flex-wrap items-start justify-between gap-2 text-xs">
		<div>
			<p class="font-medium text-neutral-200">
				{m.jobs_progress({ id: jobId, status: jobStatusLabel(progress.status) })}
			</p>
			<p class="mt-0.5 text-neutral-400">{m.jobs_phase({ phase })}</p>
		</div>
		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if progress.attempt > 0}
				<span class="tabular-nums text-neutral-400">
					{m.jobs_attempt({ attempt: progress.attempt, max: progress.maxAttempts })}
				</span>
			{/if}
			{#if !done}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-2 py-0.5 text-neutral-300"
				>
					<span
						class="size-1.5 rounded-full {connection === 'live'
							? 'bg-emerald-400'
							: connection === 'reconnecting'
								? 'bg-amber-400'
								: 'bg-neutral-400'}"
						aria-hidden="true"
					></span>
					{connectionLabel}
				</span>
			{/if}
			<span class="tabular-nums text-neutral-400">
				{m.jobs_progress_count({
					processed: progress.processed,
					total: progress.total
				})}{#if progress.total > 0}
					({pct}%){/if}
			</span>
		</div>
	</div>
	<div
		class="h-2 w-full overflow-hidden rounded bg-neutral-800"
		role="progressbar"
		aria-label={m.jobs_progress({ id: jobId, status: jobStatusLabel(progress.status) })}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={progress.total > 0 ? pct : undefined}
		aria-valuetext={progress.total > 0
			? m.jobs_progress_count({ processed: progress.processed, total: progress.total })
			: phase}
	>
		<div
			class="h-full rounded transition-all motion-reduce:transition-none {progress.status ===
				'failed' || progress.status === 'interrupted'
				? 'bg-red-500'
				: progress.status === 'partial_failed'
					? 'bg-amber-500'
					: progress.status === 'completed'
						? 'bg-emerald-500'
						: 'bg-accent-500'} {progress.total === 0 && !done ? 'motion-safe:animate-pulse' : ''}"
			style:width={progress.total > 0 ? `${pct}%` : done ? '100%' : '35%'}
		></div>
	</div>
	<div class="mt-2 flex min-h-5 items-start justify-between gap-3">
		<span class="truncate text-xs text-neutral-400" title={progress.currentItem ?? ''}>
			{progress.currentItem ?? ''}
		</span>
		{#if !done}
			<button
				type="button"
				onclick={cancel}
				disabled={cancelling}
				class="shrink-0 text-xs text-neutral-400 hover:text-red-300"
			>
				{m.jobs_cancel()}
			</button>
		{/if}
	</div>
	{#if cancelError}
		<p class="mt-2 text-xs text-red-300" role="alert">{cancelError}</p>
	{/if}
	{#if hasDetails}
		<div class="mt-3 border-t border-neutral-800 pt-3">
			<JobDetails job={progress} {onRetryStarted} />
		</div>
	{/if}
</div>

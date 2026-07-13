<script lang="ts">
	import type { PublicJobProgress } from '$lib/job-progress';
	import { jobErrorLabel, jobFailureTargetLabel, jobRetryErrorLabel } from '$lib/job-labels';
	import { m } from '$lib/paraglide/messages';

	let {
		job,
		onRetryStarted
	}: {
		job: PublicJobProgress;
		onRetryStarted?: (jobIds: number[]) => void;
	} = $props();

	let retrying = $state(false);
	let actionMessage = $state<string | null>(null);
	let actionError = $state(false);

	const resultCount = $derived(
		job.resultSummary.succeeded +
			job.resultSummary.failed +
			job.resultSummary.skipped +
			job.resultSummary.interrupted
	);
	const canRetry = $derived(
		['partial_failed', 'failed', 'interrupted'].includes(job.status) && job.retryableFailedCount > 0
	);

	async function retryFailed(): Promise<void> {
		if (!canRetry || retrying) return;
		retrying = true;
		actionMessage = null;
		actionError = false;
		try {
			const response = await fetch(`/api/jobs/${job.id}/retry`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({})
			});
			const body = (await response.json().catch(() => ({}))) as {
				jobId?: number;
				jobIds?: number[];
				error?: { code?: string; conflictingJobId?: number };
			};
			if (!response.ok || !Array.isArray(body.jobIds) || !body.jobIds.length) {
				actionError = true;
				actionMessage = jobRetryErrorLabel(body.error?.code ?? null, body.error?.conflictingJobId);
				return;
			}
			actionMessage = m.jobs_retry_started({ id: body.jobId ?? body.jobIds[0] });
			onRetryStarted?.(body.jobIds);
		} catch {
			actionError = true;
			actionMessage = m.jobs_retry_error();
		} finally {
			retrying = false;
		}
	}
</script>

<section class="space-y-3" aria-labelledby={`job-details-${job.id}`}>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h3 id={`job-details-${job.id}`} class="text-sm font-medium text-neutral-200">
			{m.jobs_details_title({ id: job.id })}
		</h3>
		{#if job.attempt > 0}
			<span class="text-xs tabular-nums text-neutral-400">
				{m.jobs_attempt({ attempt: job.attempt, max: job.maxAttempts })}
			</span>
		{/if}
	</div>

	{#if resultCount > 0}
		<p class="text-xs text-neutral-300">
			{m.jobs_result_summary({
				succeeded: job.resultSummary.succeeded,
				failed: job.resultSummary.failed,
				skipped: job.resultSummary.skipped,
				interrupted: job.resultSummary.interrupted
			})}
		</p>
	{/if}

	{#if job.error}
		<p class="text-xs text-red-300">
			{jobErrorLabel(job.error.code)}
			<code class="ml-1 text-[11px] text-red-200/80">{job.error.code}</code>
		</p>
	{/if}

	{#if job.failures.length > 0}
		<div>
			<h4 class="text-xs font-medium text-neutral-300">
				{m.jobs_failures_title({ count: job.failureCount })}
			</h4>
			<ul class="mt-2 space-y-2">
				{#each job.failures as failure (failure.outcomeId)}
					<li class="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<p class="text-xs text-neutral-300">{jobFailureTargetLabel(failure)}</p>
								<p class="mt-0.5 text-xs text-neutral-400">
									{jobErrorLabel(failure.errorCode)}
									<code class="ml-1 text-[11px] text-neutral-500">{failure.errorCode}</code>
								</p>
							</div>
							<span
								class="rounded px-2 py-0.5 text-[11px] {failure.retryable
									? 'bg-amber-950/60 text-amber-200'
									: 'bg-neutral-800 text-neutral-300'}"
							>
								{failure.retryable ? m.jobs_failure_retryable() : m.jobs_failure_permanent()}
							</span>
						</div>
					</li>
				{/each}
			</ul>
			{#if job.hiddenFailureCount > 0}
				<p class="mt-2 text-xs text-neutral-400">
					{m.jobs_hidden_failures({ count: job.hiddenFailureCount })}
				</p>
			{/if}
		</div>
	{/if}

	{#if canRetry}
		<button
			type="button"
			class="btn btn-subtle px-3 py-1.5 text-xs"
			disabled={retrying}
			onclick={retryFailed}
		>
			{retrying ? m.jobs_retrying() : m.jobs_retry_failed({ count: job.retryableFailedCount })}
		</button>
	{/if}

	{#if actionMessage}
		<p
			class="text-xs {actionError ? 'text-red-300' : 'text-emerald-300'}"
			role={actionError ? 'alert' : 'status'}
			aria-live="polite"
		>
			{actionMessage}
		</p>
	{/if}
</section>

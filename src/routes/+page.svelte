<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import JobDetails from '$lib/components/JobDetails.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import { m } from '$lib/paraglide/messages';
	import { jobStatusLabel, jobTypeLabel } from '$lib/job-labels';
	import { toasts } from '$lib/stores/toasts.svelte';

	let { data } = $props();

	let busyMode = $state<'sync' | 'full' | null>(null);
	let confirmingFullRescan = $state(false);
	let syncMessage = $state<string | null>(null);
	let syncMessageError = $state(false);
	let fullRescanConfirmButton = $state<HTMLButtonElement | null>(null);
	// Jobs started in this session (so a just-launched sync shows progress before
	// the next server load surfaces it in `data.activeJobsList`).
	const startedJobIds = new SvelteSet<number>();
	const expandedJobIds = new SvelteSet<number>();

	// The set of job ids to show live progress for: server-reported active jobs plus
	// anything started in this session that hasn't terminated yet.
	const activeJobIds = $derived.by(() => {
		const ids = new SvelteSet<number>(startedJobIds);
		for (const j of data.activeJobsList) ids.add(j.id);
		return [...ids].sort((a, b) => b - a);
	});
	const hasActive = $derived(activeJobIds.length > 0);
	const hasActiveSync = $derived(
		startedJobIds.size > 0 ||
			data.activeJobsList.some((job) => job.type === 'sync' || job.type === 'full_rescan')
	);

	// While any job is active, refresh dashboard data (stats + recent jobs) live so
	// the cards and job list climb alongside the progress bars.
	$effect(() => {
		if (!hasActive) return;
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});

	const cards = $derived([
		{ label: m.dashboard_stat_items(), value: data.stats.total },
		{ label: m.dashboard_stat_movies(), value: data.stats.movies },
		{ label: m.dashboard_stat_shows(), value: data.stats.shows },
		{ label: m.dashboard_stat_resolved(), value: data.stats.resolved },
		{ label: m.dashboard_stat_with_candidates(), value: data.stats.withCandidates },
		{ label: m.dashboard_stat_with_mediux(), value: data.stats.withMediux },
		{ label: m.dashboard_stat_applied(), value: data.stats.appliedCount }
	]);

	function reviewUrl(options: { state?: string; library?: string; attention?: boolean } = {}) {
		const params = new URLSearchParams();
		if (data.activeServerInstanceId) params.set('server', data.activeServerInstanceId);
		if (options.state) params.set('state', options.state);
		if (options.library) params.set('library', options.library);
		if (options.attention) params.set('attention', '1');
		return `/review${params.size ? `?${params.toString()}` : ''}`;
	}

	const nextActions = $derived(
		[
			{
				state: 'partial_failure',
				label: m.review_state_partial_failure(),
				hint: m.dashboard_action_partial_failure(),
				count: data.review.counts.partial_failure,
				tone: 'danger'
			},
			{
				state: 'externally_changed',
				label: m.review_state_externally_changed(),
				hint: m.dashboard_action_external_change(),
				count: data.review.counts.externally_changed,
				tone: 'warning'
			},
			{
				state: 'unresolved',
				label: m.review_state_unresolved(),
				hint: m.dashboard_action_unresolved(),
				count: data.review.counts.unresolved,
				tone: 'warning'
			},
			{
				state: 'staged',
				label: m.review_state_staged(),
				hint: m.dashboard_action_staged(),
				count: data.review.counts.staged,
				tone: 'accent'
			},
			{
				state: 'suggestion_ready',
				label: m.review_state_suggestion_ready(),
				hint: m.dashboard_action_suggestions(),
				count: data.review.counts.suggestion_ready,
				tone: 'accent'
			},
			{
				state: 'new',
				label: m.review_state_new(),
				hint: m.dashboard_action_new(),
				count: data.review.counts.new,
				tone: 'neutral'
			},
			{
				state: 'no_candidates',
				label: m.review_state_no_candidates(),
				hint: m.dashboard_action_no_candidates(),
				count: data.review.counts.no_candidates,
				tone: 'neutral'
			}
		].filter((action) => action.count > 0)
	);

	async function sync(full = false) {
		if (busyMode || hasActiveSync) return;
		busyMode = full ? 'full' : 'sync';
		syncMessage = null;
		syncMessageError = false;
		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ full })
			});
			const result = await res.json().catch(() => ({}));
			if (typeof result.jobId === 'number') {
				startedJobIds.add(result.jobId);
				confirmingFullRescan = false;
				toasts.success(full ? m.dashboard_full_rescan_started() : m.dashboard_sync_started());
			} else {
				syncMessage =
					result?.error?.code === 'job_conflict' || result?.error?.code === 'job_duplicate'
						? m.dashboard_sync_already_active()
						: m.dashboard_sync_failed();
				syncMessageError = true;
			}
		} catch {
			syncMessage = m.dashboard_sync_failed();
			syncMessageError = true;
		} finally {
			busyMode = null;
		}
	}

	function showFullRescanConfirmation(): void {
		confirmingFullRescan = true;
		queueMicrotask(() => fullRescanConfirmButton?.focus());
	}

	function onJobDone(id: number) {
		startedJobIds.delete(id);
		invalidateAll();
	}

	function toggleJobDetails(id: number): void {
		if (expandedJobIds.has(id)) expandedJobIds.delete(id);
		else expandedJobIds.add(id);
	}

	function onRetryStarted(jobIds: number[]): void {
		for (const id of jobIds) startedJobIds.add(id);
		void invalidateAll();
	}
</script>

<svelte:head><title>{m.dashboard_title()} · PosterPilot</title></svelte:head>

<div class="flex flex-wrap items-start justify-between gap-3">
	<h1 class="text-2xl font-semibold tracking-tight">{m.dashboard_title()}</h1>
	<div class="flex flex-wrap justify-end gap-2">
		<button
			type="button"
			onclick={() => sync(false)}
			disabled={busyMode !== null || hasActiveSync}
			class="btn btn-accent px-4 py-2"
		>
			{busyMode === 'sync'
				? m.dashboard_sync_starting()
				: hasActiveSync
					? m.dashboard_sync_in_progress()
					: m.dashboard_sync()}
		</button>
		<button
			type="button"
			onclick={showFullRescanConfirmation}
			disabled={busyMode !== null || hasActiveSync || confirmingFullRescan}
			class="btn btn-subtle px-4 py-2"
		>
			{m.dashboard_full_rescan()}
		</button>
	</div>
</div>

{#if confirmingFullRescan}
	<div
		class="surface mt-3 border-accent-900/60 p-4"
		role="group"
		aria-labelledby="full-rescan-confirm-title"
	>
		<h2 id="full-rescan-confirm-title" class="text-sm font-semibold text-neutral-100">
			{m.dashboard_full_rescan_confirm_title()}
		</h2>
		<p class="mt-1 max-w-3xl text-xs text-neutral-400">
			{m.dashboard_full_rescan_confirm_hint()}
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				bind:this={fullRescanConfirmButton}
				type="button"
				class="btn btn-accent"
				disabled={busyMode !== null || hasActiveSync}
				onclick={() => sync(true)}
			>
				{busyMode === 'full' ? m.dashboard_sync_starting() : m.dashboard_full_rescan_confirm()}
			</button>
			<button
				type="button"
				class="btn btn-ghost"
				disabled={busyMode !== null}
				onclick={() => (confirmingFullRescan = false)}>{m.review_cancel()}</button
			>
		</div>
	</div>
{/if}

{#if syncMessage}
	<p
		class="mt-3 text-sm {syncMessageError ? 'text-red-300' : 'text-neutral-300'}"
		role={syncMessageError ? 'alert' : 'status'}
		aria-live="polite"
	>
		{syncMessage}
	</p>
{/if}

{#if hasActive}
	<section class="mt-4 space-y-3">
		{#each activeJobIds as jobId (jobId)}
			<JobProgress {jobId} onDone={() => onJobDone(jobId)} {onRetryStarted} />
		{/each}
	</section>
{/if}

<section class="mt-6" aria-labelledby="dashboard-next-actions">
	<div class="flex flex-wrap items-end justify-between gap-2">
		<div>
			<h2 id="dashboard-next-actions" class="section-title">{m.dashboard_next_actions()}</h2>
			<p class="mt-1 text-xs text-neutral-400">{m.dashboard_next_actions_hint()}</p>
		</div>
		<a class="text-xs text-neutral-400 hover:text-accent-200" href={reviewUrl({ attention: true })}>
			{m.dashboard_open_review()} →
		</a>
	</div>

	{#if nextActions.length > 0 || data.review.failedJobs > 0}
		<div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{#each nextActions as action (action.state)}
				<a
					href={reviewUrl({ state: action.state })}
					class="surface group p-4 transition hover:-translate-y-0.5 hover:border-neutral-600 motion-reduce:transform-none {action.tone ===
					'danger'
						? 'border-red-900/60'
						: action.tone === 'warning'
							? 'border-amber-900/50'
							: action.tone === 'accent'
								? 'border-accent-900/60'
								: ''}"
				>
					<div class="flex items-start justify-between gap-3">
						<p class="text-sm font-medium text-neutral-200">{action.label}</p>
						<span class="text-neutral-500 transition group-hover:text-accent-300" aria-hidden="true"
							>↗</span
						>
					</div>
					<p class="mt-2 text-3xl font-semibold tabular-nums text-neutral-50">{action.count}</p>
					<p class="mt-1 text-xs text-neutral-400">{action.hint}</p>
				</a>
			{/each}
			{#if data.review.failedJobs > 0}
				<a
					href="/settings?tab=activity"
					class="surface group border-red-900/60 p-4 transition hover:-translate-y-0.5 hover:border-red-700 motion-reduce:transform-none"
				>
					<div class="flex items-start justify-between gap-3">
						<p class="text-sm font-medium text-neutral-200">{m.dashboard_failed_jobs()}</p>
						<span class="text-neutral-500 group-hover:text-red-300" aria-hidden="true">↗</span>
					</div>
					<p class="mt-2 text-3xl font-semibold tabular-nums text-red-200">
						{data.review.failedJobs}
					</p>
					<p class="mt-1 text-xs text-neutral-400">{m.dashboard_failed_jobs_hint()}</p>
				</a>
			{/if}
		</div>
	{:else}
		<div class="surface mt-3 p-5">
			<p class="text-sm font-medium text-neutral-200">{m.dashboard_all_clear()}</p>
			<p class="mt-1 text-xs text-neutral-400">{m.dashboard_all_clear_hint()}</p>
		</div>
	{/if}

	{#if data.review.libraries.length > 0}
		<div class="mt-4 flex flex-wrap items-center gap-2">
			<span class="text-xs text-neutral-500">{m.dashboard_by_library()}</span>
			{#each data.review.libraries as library (library.sectionKey)}
				<a
					class="chip hover:border-neutral-600"
					href={reviewUrl({ library: library.sectionKey, attention: true })}
				>
					{library.sectionKey} · {m.dashboard_actionable_count({
						count: library.actionable
					})}{#if library.exceptions > 0}
						· {m.dashboard_exception_count({ count: library.exceptions })}{/if}
				</a>
			{/each}
		</div>
	{/if}
</section>

<!-- "Items" leads as the headline total (accent); the rest are supporting figures
     in neutral so the violet stays meaningful rather than decorating every number. -->
<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-8">
	{#each cards as card, i (card.label)}
		<div class="surface p-4 {i === 0 ? 'col-span-2 sm:col-span-3 lg:col-span-2' : ''}">
			<p
				class="font-semibold tabular-nums {i === 0
					? 'text-4xl text-accent-300'
					: 'text-2xl text-neutral-100'}"
			>
				{card.value}
			</p>
			<p class="text-xs text-neutral-400">{card.label}</p>
		</div>
	{/each}
</div>

<div class="mt-8 flex items-center justify-between">
	<h2 class="section-title">{m.dashboard_recent_jobs()}</h2>
	<a href="/settings?tab=activity" class="text-xs text-neutral-400 hover:text-accent-200"
		>{m.dashboard_view_activity()}</a
	>
</div>
<div class="surface overflow-hidden">
	{#if data.jobs.length === 0}
		<p class="p-4 text-sm text-neutral-400">{m.dashboard_no_jobs()}</p>
	{:else}
		<table class="w-full text-sm">
			<thead class="text-left text-xs text-neutral-400">
				<tr class="border-b border-neutral-800">
					<th class="px-4 py-2 font-medium">{m.jobs_col_id()}</th>
					<th class="px-4 py-2 font-medium">{m.jobs_col_type()}</th>
					<th class="px-4 py-2 font-medium">{m.jobs_col_progress()}</th>
					<th class="px-4 py-2 font-medium">{m.jobs_col_status()}</th>
					<th class="px-4 py-2 font-medium"><span class="sr-only">{m.jobs_details_show()}</span></th
					>
				</tr>
			</thead>
			<tbody>
				{#each data.jobs as job (job.id)}
					<tr class="border-b border-neutral-800/60 last:border-0">
						<td class="px-4 py-2 text-neutral-400">#{job.id}</td>
						<td class="px-4 py-2">{jobTypeLabel(job.type)}</td>
						<td class="px-4 py-2 text-neutral-400">
							{m.jobs_progress_count({ processed: job.processed, total: job.total })}
						</td>
						<td class="px-4 py-2">
							<span
								class="rounded px-2 py-0.5 text-xs {job.status === 'completed'
									? 'bg-emerald-900/50 text-emerald-300'
									: job.status === 'failed' || job.status === 'interrupted'
										? 'bg-red-900/50 text-red-300'
										: job.status === 'partial_failed'
											? 'bg-amber-900/50 text-amber-200'
											: job.status === 'running'
												? 'bg-accent-900/50 text-accent-300'
												: 'bg-neutral-800 text-neutral-400'}">{jobStatusLabel(job.status)}</span
							>
						</td>
						<td class="px-4 py-2 text-right">
							<button
								type="button"
								class="btn btn-ghost px-2 py-1 text-xs"
								aria-expanded={expandedJobIds.has(job.id)}
								aria-controls={`job-row-details-${job.id}`}
								onclick={() => toggleJobDetails(job.id)}
							>
								{expandedJobIds.has(job.id) ? m.jobs_details_hide() : m.jobs_details_show()}
							</button>
						</td>
					</tr>
					{#if expandedJobIds.has(job.id)}
						<tr
							id={`job-row-details-${job.id}`}
							class="border-b border-neutral-800/60 last:border-0"
						>
							<td colspan="5" class="bg-neutral-950/30 px-4 py-4">
								<JobDetails {job} {onRetryStarted} />
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	let busy = $state(false);
	// Jobs started in this session (so a just-launched sync shows progress before
	// the next server load surfaces it in `data.activeJobsList`).
	const startedJobIds = new SvelteSet<number>();

	// The set of job ids to show live progress for: server-reported active jobs plus
	// anything started in this session that hasn't terminated yet.
	const activeJobIds = $derived.by(() => {
		const ids = new SvelteSet<number>(startedJobIds);
		for (const j of data.activeJobsList) ids.add(j.id);
		return [...ids].sort((a, b) => b - a);
	});
	const hasActive = $derived(activeJobIds.length > 0);

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
		{ label: m.dashboard_stat_with_mediux(), value: data.stats.withMediux },
		{ label: m.dashboard_stat_applied(), value: data.stats.appliedCount }
	]);

	async function sync() {
		busy = true;
		try {
			const res = await fetch('/api/sync', { method: 'POST' });
			const { jobId } = await res.json();
			if (typeof jobId === 'number') startedJobIds.add(jobId);
		} finally {
			busy = false;
		}
	}

	function onJobDone(id: number) {
		startedJobIds.delete(id);
		invalidateAll();
	}
</script>

<svelte:head><title>{m.dashboard_title()} · PosterPilot</title></svelte:head>

<div class="flex items-center justify-between">
	<h1 class="text-2xl font-semibold tracking-tight">{m.dashboard_title()}</h1>
	<button onclick={sync} disabled={busy} class="btn btn-accent px-4 py-2">
		{busy ? m.dashboard_sync_starting() : m.dashboard_sync()}
	</button>
</div>

{#if hasActive}
	<section class="mt-4 space-y-3">
		{#each activeJobIds as jobId (jobId)}
			<JobProgress {jobId} onDone={() => onJobDone(jobId)} />
		{/each}
	</section>
{/if}

<!-- "Items" leads as the headline total (accent); the rest are supporting figures
     in neutral so the violet stays meaningful rather than decorating every number. -->
<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
				</tr>
			</thead>
			<tbody>
				{#each data.jobs as job (job.id)}
					<tr class="border-b border-neutral-800/60 last:border-0">
						<td class="px-4 py-2 text-neutral-400">#{job.id}</td>
						<td class="px-4 py-2">{job.type}</td>
						<td class="px-4 py-2 text-neutral-400">{job.processed}/{job.total}</td>
						<td class="px-4 py-2">
							<span
								class="rounded px-2 py-0.5 text-xs {job.status === 'completed'
									? 'bg-emerald-900/50 text-emerald-300'
									: job.status === 'failed' || job.status === 'interrupted'
										? 'bg-red-900/50 text-red-300'
										: job.status === 'running'
											? 'bg-accent-900/50 text-accent-300'
											: 'bg-neutral-800 text-neutral-400'}">{job.status}</span
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

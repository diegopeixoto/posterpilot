<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import JobProgress from '$lib/components/JobProgress.svelte';

	let { data } = $props();

	let syncJobId = $state<number | null>(null);
	let running = $state(false);
	let busy = $state(false);

	// While a job is running, refresh dashboard data (stats + recent jobs) live so
	// the cards and job list climb alongside the progress bar.
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});

	const cards = $derived([
		{ label: 'Items', value: data.stats.total },
		{ label: 'Movies', value: data.stats.movies },
		{ label: 'Shows', value: data.stats.shows },
		{ label: 'Resolved', value: data.stats.resolved },
		{ label: 'With MediaUX', value: data.stats.withMediux },
		{ label: 'Applied', value: data.stats.appliedCount }
	]);

	async function sync() {
		busy = true;
		try {
			const res = await fetch('/api/sync', { method: 'POST' });
			const { jobId } = await res.json();
			syncJobId = jobId;
			running = true;
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex items-center justify-between">
	<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
	<button onclick={sync} disabled={busy} class="btn btn-accent px-4 py-2">
		{busy ? 'Starting…' : 'Sync library'}
	</button>
</div>

{#if syncJobId}
	<div class="mt-4">
		<JobProgress
			jobId={syncJobId}
			onDone={() => {
				running = false;
				invalidateAll();
			}}
		/>
	</div>
{/if}

<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
	{#each cards as card (card.label)}
		<div class="surface p-4">
			<p class="text-2xl font-semibold text-accent-300">{card.value}</p>
			<p class="text-xs text-neutral-500">{card.label}</p>
		</div>
	{/each}
</div>

<h2 class="section-title mt-8">Recent jobs</h2>
<div class="surface overflow-hidden">
	{#if data.jobs.length === 0}
		<p class="p-4 text-sm text-neutral-500">No jobs yet. Run a sync to populate your library.</p>
	{:else}
		<table class="w-full text-sm">
			<tbody>
				{#each data.jobs as job (job.id)}
					<tr class="border-b border-neutral-800/60 last:border-0">
						<td class="px-4 py-2 text-neutral-500">#{job.id}</td>
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

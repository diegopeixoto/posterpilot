<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import JobProgress from '$lib/components/JobProgress.svelte';

	let { data } = $props();

	const active = $derived(
		data.jobs.filter((j) => j.status === 'pending' || j.status === 'running')
	);
	const past = $derived(data.jobs.filter((j) => j.status !== 'pending' && j.status !== 'running'));

	function fmt(ts: Date | null): string {
		return ts ? new Date(ts).toLocaleString() : '—';
	}
</script>

<h1 class="text-2xl font-semibold tracking-tight">Jobs</h1>

{#if active.length}
	<section class="mt-4 space-y-3">
		{#each active as job (job.id)}
			<JobProgress jobId={job.id} onDone={() => invalidateAll()} />
		{/each}
	</section>
{/if}

<h2 class="section-title mt-8">History</h2>
<div class="surface overflow-hidden">
	{#if past.length === 0}
		<p class="p-4 text-sm text-neutral-500">No past jobs.</p>
	{:else}
		<table class="w-full text-sm">
			<thead class="text-left text-xs text-neutral-500">
				<tr class="border-b border-neutral-800">
					<th class="px-4 py-2 font-medium">#</th>
					<th class="px-4 py-2 font-medium">Type</th>
					<th class="px-4 py-2 font-medium">Progress</th>
					<th class="px-4 py-2 font-medium">Status</th>
					<th class="px-4 py-2 font-medium">Finished</th>
				</tr>
			</thead>
			<tbody>
				{#each past as job (job.id)}
					<tr class="border-b border-neutral-800/60 last:border-0">
						<td class="px-4 py-2 text-neutral-500">{job.id}</td>
						<td class="px-4 py-2">{job.type}</td>
						<td class="px-4 py-2 text-neutral-400">{job.processed}/{job.total}</td>
						<td class="px-4 py-2">
							<span
								class="rounded px-2 py-0.5 text-xs {job.status === 'completed'
									? 'bg-emerald-900/50 text-emerald-300'
									: job.status === 'failed' || job.status === 'interrupted'
										? 'bg-red-900/50 text-red-300'
										: 'bg-neutral-800 text-neutral-400'}">{job.status}</span
							>
							{#if job.error}<span class="ml-2 text-xs text-red-400/80">{job.error}</span>{/if}
						</td>
						<td class="px-4 py-2 text-neutral-500">{fmt(job.finishedAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

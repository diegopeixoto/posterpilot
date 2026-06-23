<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import PosterCard from '$lib/components/PosterCard.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';

	let { data } = $props();

	const selected = new SvelteSet<number>();
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let jobId = $state<number | null>(null);

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}
	function clearSelection() {
		selected.clear();
	}

	async function bulk(path: string, extra: Record<string, unknown> = {}) {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ itemIds: [...selected], ...extra })
		});
		const { jobId: id } = await res.json();
		jobId = id;
		clearSelection();
	}
</script>

<div class="flex items-center justify-between">
	<h1 class="text-2xl font-semibold tracking-tight">Library</h1>
	<span class="text-sm text-neutral-500">{data.items.length} items</span>
</div>

<form method="get" class="mt-4 flex flex-wrap items-center gap-2 text-sm">
	<input
		name="q"
		value={data.filter.q ?? ''}
		placeholder="Search title…"
		class="w-48 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 outline-none focus:border-indigo-500"
	/>
	<select
		name="type"
		value={data.filter.type ?? ''}
		class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5"
	>
		<option value="">All types</option>
		<option value="movie">Movies</option>
		<option value="show">Shows</option>
	</select>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input type="checkbox" name="mediux" value="1" checked={data.filter.hasMediux} /> has MediaUX
	</label>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input type="checkbox" name="missing" value="1" checked={data.filter.missingPoster} /> missing poster
	</label>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input type="checkbox" name="unchanged" value="1" checked={data.filter.unchanged} /> default (unchanged)
	</label>
	<button class="rounded-md bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700">Filter</button>
</form>

{#if selected.size > 0}
	<div
		class="sticky top-14 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-800 bg-indigo-950/60 px-4 py-2 text-sm backdrop-blur"
	>
		<span class="font-medium">{selected.size} selected</span>
		<button onclick={() => bulk('/api/discover')} class="rounded bg-neutral-800 px-3 py-1 hover:bg-neutral-700"
			>Find covers</button
		>
		<select bind:value={method} class="rounded border border-neutral-700 bg-neutral-900 px-2 py-1">
			<option value="both">Plex + Kometa</option>
			<option value="plex">Plex only</option>
			<option value="kometa">Kometa only</option>
		</select>
		<button
			onclick={() => bulk('/api/apply', { method, selection: 'auto' })}
			class="rounded bg-indigo-600 px-3 py-1 font-medium text-white hover:bg-indigo-500">Apply (auto)</button
		>
		<button onclick={clearSelection} class="ml-auto text-neutral-400 hover:text-neutral-200">Clear</button>
	</div>
{/if}

{#if jobId}
	<div class="mt-4">
		<JobProgress {jobId} onDone={() => invalidateAll()} />
	</div>
{/if}

{#if data.items.length === 0}
	<div class="mt-10 rounded-lg border border-neutral-800 bg-neutral-900 p-10 text-center text-neutral-500">
		No items. Configure Plex in Settings and run a sync from the Dashboard.
	</div>
{:else}
	<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
		{#each data.items as item (item.id)}
			<PosterCard {item} selectable selected={selected.has(item.id)} onToggle={() => toggle(item.id)} />
		{/each}
	</div>
{/if}

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

<!-- Spotlight -->
{#if data.spotlight?.backdropUrl}
	<a
		href={`/item/${data.spotlight.id}`}
		class="relative mt-4 block h-40 overflow-hidden rounded-xl border border-neutral-800"
	>
		<img
			src={data.spotlight.backdropUrl}
			alt=""
			class="absolute inset-0 h-full w-full object-cover"
		/>
		<div class="absolute inset-0 bg-gradient-to-r from-neutral-950/90 to-transparent"></div>
		<div class="absolute bottom-4 left-5">
			<p class="text-xs tracking-wide text-accent-300 uppercase">Recently updated</p>
			<p class="text-lg font-semibold text-white">{data.spotlight.title}</p>
			<p class="text-xs text-neutral-300">{data.spotlight.year ?? ''}</p>
		</div>
	</a>
{/if}

<!-- Filters -->
<form method="get" class="surface mt-4 flex flex-wrap items-center gap-2 p-3 text-sm">
	<input name="q" value={data.filter.q ?? ''} placeholder="Search title…" class="input w-44" />
	<select name="type" value={data.filter.type ?? ''} class="input">
		<option value="">All types</option>
		<option value="movie">Movies</option>
		<option value="show">Shows</option>
	</select>
	<select name="sort" value={data.filter.sort ?? 'title'} class="input">
		<option value="title">Title A→Z</option>
		<option value="rating">Rating ↓</option>
		<option value="year">Year ↓</option>
		<option value="runtime">Runtime ↓</option>
		<option value="recent">Recently changed</option>
	</select>
	<select name="minRating" value={data.filter.minRating?.toString() ?? ''} class="input">
		<option value="">Any rating</option>
		<option value="6">★ 6+</option>
		<option value="7">★ 7+</option>
		<option value="8">★ 8+</option>
		<option value="9">★ 9+</option>
	</select>
	{#if data.genres.length}
		<select name="genre" value={data.filter.genre ?? ''} class="input">
			<option value="">All genres</option>
			{#each data.genres as g (g)}<option value={g}>{g}</option>{/each}
		</select>
	{/if}
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input type="checkbox" name="mediux" value="1" checked={data.filter.hasMediux} /> MediUX
	</label>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input type="checkbox" name="missing" value="1" checked={data.filter.missingPoster} /> missing
	</label>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input type="checkbox" name="unchanged" value="1" checked={data.filter.unchanged} /> unchanged
	</label>
	<button class="btn btn-subtle">Apply</button>
</form>

{#if selected.size > 0}
	<div
		class="surface sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-3 border-accent-800 bg-accent-950/40 px-4 py-2 text-sm backdrop-blur"
	>
		<span class="font-medium">{selected.size} selected</span>
		<button onclick={() => bulk('/api/discover')} class="btn btn-subtle px-3 py-1"
			>Find covers</button
		>
		<select bind:value={method} class="input py-1">
			<option value="both">Plex + Kometa</option>
			<option value="plex">Plex only</option>
			<option value="kometa">Kometa only</option>
		</select>
		<button
			onclick={() => bulk('/api/apply', { method, selection: 'auto' })}
			class="btn btn-accent px-3 py-1">Apply (auto)</button
		>
		<button onclick={clearSelection} class="ml-auto text-neutral-400 hover:text-neutral-200"
			>Clear</button
		>
	</div>
{/if}

{#if jobId}
	<div class="mt-4"><JobProgress {jobId} onDone={() => invalidateAll()} /></div>
{/if}

{#if data.items.length === 0}
	<div class="surface mt-10 p-10 text-center text-neutral-500">
		No items. Configure Plex in Settings and run a sync from the Dashboard.
	</div>
{:else}
	<div
		class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
	>
		{#each data.items as item (item.id)}
			<PosterCard
				{item}
				selectable
				selected={selected.has(item.id)}
				onToggle={() => toggle(item.id)}
			/>
		{/each}
	</div>
{/if}

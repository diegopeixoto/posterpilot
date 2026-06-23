<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import PosterCard from '$lib/components/PosterCard.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	const selected = new SvelteSet<number>();
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let jobId = $state<number | null>(null);

	// Filters apply on change by default; the user can toggle this off (persisted).
	let autoApply = $state(true);
	let searchTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const saved = localStorage.getItem('pp_autoapply');
		if (saved !== null) autoApply = saved === '1';
	});
	function toggleAuto() {
		autoApply = !autoApply;
		localStorage.setItem('pp_autoapply', autoApply ? '1' : '0');
	}
	function submitForm(el: EventTarget | null) {
		(el as HTMLElement | null)?.closest('form')?.requestSubmit();
	}
	function onControlChange(e: Event) {
		if (autoApply) submitForm(e.currentTarget);
	}
	function onSearchInput(e: Event) {
		if (!autoApply) return;
		clearTimeout(searchTimer);
		const target = e.currentTarget;
		searchTimer = setTimeout(() => submitForm(target), 400);
	}

	// Sort field + direction. Title ascends by default; other fields descend.
	function defaultDir(sort: string | undefined): 'asc' | 'desc' {
		return sort === 'title' || sort === undefined ? 'asc' : 'desc';
	}
	let dir = $state<'asc' | 'desc'>(data.filter.dir ?? defaultDir(data.filter.sort));
	function onSortChange(e: Event) {
		const sel = e.currentTarget as HTMLSelectElement;
		dir = defaultDir(sel.value); // reset to the field's natural direction
		if (autoApply) submitForm(sel);
	}
	function toggleDir(e: Event) {
		dir = dir === 'asc' ? 'desc' : 'asc';
		if (autoApply) submitForm(e.currentTarget);
	}

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
	<h1 class="text-2xl font-semibold tracking-tight">{m.library_title()}</h1>
	<span class="text-sm text-neutral-500">{m.library_item_count({ count: data.items.length })}</span>
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
			<p class="text-xs tracking-wide text-accent-300 uppercase">{m.library_recently_updated()}</p>
			<p class="text-lg font-semibold text-white">{data.spotlight.title}</p>
			<p class="text-xs text-neutral-300">{data.spotlight.year ?? ''}</p>
		</div>
	</a>
{/if}

<!-- Filters -->
<form method="get" class="surface mt-4 flex flex-wrap items-center gap-2 p-3 text-sm">
	<input
		name="q"
		value={data.filter.q ?? ''}
		placeholder={m.library_search_placeholder()}
		oninput={onSearchInput}
		class="input w-44"
	/>
	<select name="type" value={data.filter.type ?? ''} onchange={onControlChange} class="input">
		<option value="">{m.library_all_types()}</option>
		<option value="movie">{m.library_type_movies()}</option>
		<option value="show">{m.library_type_shows()}</option>
	</select>
	<div class="flex items-center gap-1">
		<select name="sort" value={data.filter.sort ?? 'title'} onchange={onSortChange} class="input">
			<option value="title">{m.library_sort_title()}</option>
			<option value="rating">{m.library_sort_rating()}</option>
			<option value="year">{m.library_sort_year()}</option>
			<option value="runtime">{m.library_sort_runtime()}</option>
			<option value="recent">{m.library_sort_recent()}</option>
		</select>
		<input type="hidden" name="dir" value={dir} />
		<button
			type="button"
			onclick={toggleDir}
			title={m.library_sort_dir()}
			aria-label={m.library_sort_dir()}
			class="btn btn-ghost px-2"
		>
			{dir === 'asc' ? '↑' : '↓'}
		</button>
	</div>
	<select
		name="minRating"
		value={data.filter.minRating?.toString() ?? ''}
		onchange={onControlChange}
		class="input"
	>
		<option value="">{m.library_any_rating()}</option>
		<option value="6">{m.library_rating_6()}</option>
		<option value="7">{m.library_rating_7()}</option>
		<option value="8">{m.library_rating_8()}</option>
		<option value="9">{m.library_rating_9()}</option>
	</select>
	{#if data.genres.length}
		<select name="genre" value={data.filter.genre ?? ''} onchange={onControlChange} class="input">
			<option value="">{m.library_all_genres()}</option>
			{#each data.genres as g (g)}<option value={g}>{g}</option>{/each}
		</select>
	{/if}
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input
			type="checkbox"
			name="mediux"
			value="1"
			checked={data.filter.hasMediux}
			onchange={onControlChange}
		/>
		{m.library_filter_mediux()}
	</label>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input
			type="checkbox"
			name="missing"
			value="1"
			checked={data.filter.missingPoster}
			onchange={onControlChange}
		/>
		{m.library_filter_missing()}
	</label>
	<label class="flex items-center gap-1.5 text-neutral-400">
		<input
			type="checkbox"
			name="unchanged"
			value="1"
			checked={data.filter.unchanged}
			onchange={onControlChange}
		/>
		{m.library_filter_unchanged()}
	</label>
	<button
		type="button"
		onclick={toggleAuto}
		title={m.library_autoapply()}
		aria-label={m.library_autoapply()}
		aria-pressed={autoApply}
		class="btn px-2 {autoApply ? 'btn-accent' : 'btn-ghost text-neutral-500'}"
	>
		⚡
	</button>
	{#if !autoApply}
		<button class="btn btn-subtle">{m.library_apply_filters()}</button>
	{/if}
</form>

{#if selected.size > 0}
	<div
		class="surface sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-3 border-accent-800 bg-accent-950/40 px-4 py-2 text-sm backdrop-blur"
	>
		<span class="font-medium">{m.library_selected_count({ count: selected.size })}</span>
		<button onclick={() => bulk('/api/discover')} class="btn btn-subtle px-3 py-1"
			>{m.library_find_covers()}</button
		>
		<select bind:value={method} class="input py-1">
			<option value="both">{m.library_method_both()}</option>
			<option value="plex">{m.library_method_plex()}</option>
			<option value="kometa">{m.library_method_kometa()}</option>
		</select>
		<button
			onclick={() => bulk('/api/apply', { method, selection: 'auto' })}
			class="btn btn-accent px-3 py-1">{m.library_apply_auto()}</button
		>
		<button onclick={clearSelection} class="ml-auto text-neutral-400 hover:text-neutral-200"
			>{m.library_clear()}</button
		>
	</div>
{/if}

{#if jobId}
	<div class="mt-4"><JobProgress {jobId} onDone={() => invalidateAll()} /></div>
{/if}

{#if data.items.length === 0}
	<div class="surface mt-10 p-10 text-center text-neutral-500">
		{m.library_empty()}
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

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import PosterCard from '$lib/components/PosterCard.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	const selected = new SvelteSet<number>();
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let jobId = $state<number | null>(null);

	// Filters apply on change by default; the user can toggle this off (persisted).
	// All controls drive the SAME query params; when autoApply is on, a change navigates
	// immediately, otherwise we stage changes locally and apply them with the Apply button.
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

	// Sort field + direction. Title ascends by default; other fields descend.
	function defaultDir(sort: string | undefined): 'asc' | 'desc' {
		return sort === 'title' || sort === undefined ? 'asc' : 'desc';
	}
	let dir = $state<'asc' | 'desc'>(data.filter.dir ?? defaultDir(data.filter.sort));

	// Popover open state.
	let filterOpen = $state(false);
	let sortOpen = $state(false);

	// Labels for the current selections, used by the toolbar triggers and chips.
	const sortLabels: Record<string, () => string> = {
		title: m.library_sort_title,
		rating: m.library_sort_rating,
		year: m.library_sort_year,
		runtime: m.library_sort_runtime,
		recent: m.library_sort_recent
	};
	const typeLabels: Record<string, () => string> = {
		movie: m.library_type_movies,
		show: m.library_type_shows
	};
	const sortField = $derived(data.filter.sort ?? 'title');
	const sortDir = $derived(data.filter.dir ?? defaultDir(data.filter.sort));
	// The sort is "active" (chip-worthy) when a non-default field or direction is set.
	const hasSort = $derived(!!data.filter.sort || sortDir !== defaultDir(data.filter.sort));

	// How many filter facets (not sort) are currently active — drives the Filter badge.
	const activeFilterCount = $derived(
		(data.filter.type ? 1 : 0) +
			(data.filter.minRating ? 1 : 0) +
			(data.filter.genre ? 1 : 0) +
			(data.filter.hasMediux ? 1 : 0) +
			(data.filter.missingPoster ? 1 : 0) +
			(data.filter.unchanged ? 1 : 0)
	);
	const hasAnyFilter = $derived(activeFilterCount > 0 || !!data.filter.q);

	// Locally staged params, applied to the URL only when autoApply is off and the user
	// hits Apply. When autoApply is on, this is kept in sync but each change navigates.
	let staged = $state<Record<string, string | undefined>>({});

	/** Build a library URL from the current params, overriding the given keys. */
	function urlWith(overrides: Record<string, string | undefined>): string {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(overrides)) {
			if (value === undefined || value === '') params.delete(key);
			else params.set(key, value);
		}
		const qs = params.toString();
		return qs ? `/library?${qs}` : '/library';
	}

	function navigate(overrides: Record<string, string | undefined>) {
		goto(urlWith(overrides), { keepFocus: true, noScroll: true });
	}

	/** A filter control changed: stage it, and navigate immediately when auto-apply is on. */
	function setParam(key: string, value: string | undefined) {
		staged[key] = value;
		if (autoApply) navigate({ [key]: value });
	}

	/** Apply any staged filter changes at once (manual mode). */
	function applyStaged() {
		navigate(staged);
		staged = {};
		filterOpen = false;
	}

	function onTypeChange(e: Event) {
		setParam('type', (e.currentTarget as HTMLSelectElement).value || undefined);
	}
	function onMinRatingChange(e: Event) {
		setParam('minRating', (e.currentTarget as HTMLSelectElement).value || undefined);
	}
	function onGenreChange(e: Event) {
		setParam('genre', (e.currentTarget as HTMLSelectElement).value || undefined);
	}
	function onToggle(key: string, e: Event) {
		setParam(key, (e.currentTarget as HTMLInputElement).checked ? '1' : undefined);
	}

	function onSearchInput(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value || undefined;
		staged.q = value;
		if (!autoApply) return;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => navigate({ q: value }), 400);
	}
	function onSearchSubmit(e: Event) {
		e.preventDefault();
		navigate({ q: staged.q ?? data.filter.q });
	}

	// Sort: selecting a field resets to its natural direction; the toggle flips it.
	// Sort always applies immediately (it's not part of the staged filter set).
	function onSortChange(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value;
		dir = defaultDir(value);
		navigate({ sort: value === 'title' ? undefined : value, dir });
	}
	function toggleDir() {
		dir = dir === 'asc' ? 'desc' : 'asc';
		navigate({ sort: data.filter.sort, dir });
	}

	/** Remove a single filter param (chip ✕) and re-navigate. */
	function removeParam(...keys: string[]) {
		const overrides: Record<string, string | undefined> = {};
		for (const key of keys) {
			overrides[key] = undefined;
			delete staged[key];
		}
		navigate(overrides);
	}

	/** Reset every filter + sort back to defaults. */
	function clearAll() {
		dir = defaultDir(undefined);
		staged = {};
		goto('/library', { keepFocus: true, noScroll: true });
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

<svelte:head><title>{m.library_title()} · PosterPilot</title></svelte:head>

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

<!-- Toolbar: search · Filter · Sort · auto-apply -->
<div class="mt-4 flex flex-wrap items-center gap-2 text-sm">
	<form onsubmit={onSearchSubmit}>
		<input
			name="q"
			value={data.filter.q ?? ''}
			placeholder={m.library_search_placeholder()}
			oninput={onSearchInput}
			class="input w-44"
		/>
	</form>

	<!-- Filter popover -->
	<Popover bind:open={filterOpen} label={m.library_filter_button()} active={activeFilterCount > 0}>
		{#snippet trigger()}
			<svg
				class="size-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M3 5h18M6 12h12M10 19h4" />
			</svg>
			<span>{m.library_filter_button()}</span>
			{#if activeFilterCount > 0}
				<span class="rounded-full bg-accent-600 px-1.5 text-[10px] font-semibold text-white">
					{activeFilterCount}
				</span>
			{/if}
		{/snippet}
		<div class="space-y-3">
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.library_filter_type()}</span>
				<select value={data.filter.type ?? ''} onchange={onTypeChange} class="input w-full">
					<option value="">{m.library_all_types()}</option>
					<option value="movie">{m.library_type_movies()}</option>
					<option value="show">{m.library_type_shows()}</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.library_filter_min_rating()}</span>
				<select
					value={data.filter.minRating?.toString() ?? ''}
					onchange={onMinRatingChange}
					class="input w-full"
				>
					<option value="">{m.library_any_rating()}</option>
					<option value="6">{m.library_rating_6()}</option>
					<option value="7">{m.library_rating_7()}</option>
					<option value="8">{m.library_rating_8()}</option>
					<option value="9">{m.library_rating_9()}</option>
				</select>
			</label>
			{#if data.genres.length}
				<label class="block">
					<span class="mb-1 block text-xs text-neutral-400">{m.library_filter_genre()}</span>
					<select value={data.filter.genre ?? ''} onchange={onGenreChange} class="input w-full">
						<option value="">{m.library_all_genres()}</option>
						{#each data.genres as g (g)}<option value={g}>{g}</option>{/each}
					</select>
				</label>
			{/if}
			<div class="space-y-1.5 border-t border-neutral-800 pt-2">
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={data.filter.hasMediux}
						onchange={(e) => onToggle('mediux', e)}
					/>
					{m.library_filter_mediux()}
				</label>
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={data.filter.missingPoster}
						onchange={(e) => onToggle('missing', e)}
					/>
					{m.library_filter_missing()}
				</label>
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={data.filter.unchanged}
						onchange={(e) => onToggle('unchanged', e)}
					/>
					{m.library_filter_unchanged()}
				</label>
			</div>
			{#if !autoApply}
				<button type="button" class="btn btn-subtle w-full" onclick={applyStaged}>
					{m.library_apply_filters()}
				</button>
			{/if}
		</div>
	</Popover>

	<!-- Sort popover -->
	<Popover bind:open={sortOpen} label={m.library_sort_button()} active={hasSort}>
		{#snippet trigger()}
			<svg
				class="size-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M3 6h10M3 12h7M3 18h4M16 5v14M16 19l3-3M16 19l-3-3" />
			</svg>
			<span>{m.library_sort_button()}</span>
		{/snippet}
		<div class="space-y-3">
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.library_sort_button()}</span>
				<select value={data.filter.sort ?? 'title'} onchange={onSortChange} class="input w-full">
					<option value="title">{m.library_sort_title()}</option>
					<option value="rating">{m.library_sort_rating()}</option>
					<option value="year">{m.library_sort_year()}</option>
					<option value="runtime">{m.library_sort_runtime()}</option>
					<option value="recent">{m.library_sort_recent()}</option>
				</select>
			</label>
			<button
				type="button"
				onclick={toggleDir}
				class="btn btn-ghost w-full justify-between"
				aria-label={m.library_sort_dir()}
			>
				<span>{m.library_sort_dir()}</span>
				<span>{sortDir === 'asc' ? '↑ ' + m.library_sort_asc() : '↓ ' + m.library_sort_desc()}</span
				>
			</button>
		</div>
	</Popover>

	<button
		type="button"
		onclick={toggleAuto}
		title={m.library_autoapply()}
		aria-label={m.library_autoapply()}
		aria-pressed={autoApply}
		class="btn px-2 py-1.5 {autoApply ? 'btn-accent' : 'btn-ghost text-neutral-500'}"
	>
		⚡
	</button>

	{#if hasAnyFilter || hasSort}
		<button type="button" onclick={clearAll} class="text-neutral-400 hover:text-neutral-200">
			{m.library_clear_all()}
		</button>
	{/if}
</div>

<!-- Active filter chips -->
{#if hasAnyFilter || hasSort}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if data.filter.q}
			<button type="button" onclick={() => removeParam('q')} class="chip chip-active gap-1">
				<span>“{data.filter.q}”</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if data.filter.type}
			<button type="button" onclick={() => removeParam('type')} class="chip chip-active gap-1">
				<span>{typeLabels[data.filter.type]()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if data.filter.minRating}
			<button type="button" onclick={() => removeParam('minRating')} class="chip chip-active gap-1">
				<span>★ ≥ {data.filter.minRating}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if data.filter.genre}
			<button type="button" onclick={() => removeParam('genre')} class="chip chip-active gap-1">
				<span>{data.filter.genre}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if data.filter.hasMediux}
			<button type="button" onclick={() => removeParam('mediux')} class="chip chip-active gap-1">
				<span>{m.library_filter_mediux()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if data.filter.missingPoster}
			<button type="button" onclick={() => removeParam('missing')} class="chip chip-active gap-1">
				<span>{m.library_filter_missing()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if data.filter.unchanged}
			<button type="button" onclick={() => removeParam('unchanged')} class="chip chip-active gap-1">
				<span>{m.library_filter_unchanged()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if hasSort}
			<button
				type="button"
				onclick={() => removeParam('sort', 'dir')}
				class="chip chip-active gap-1"
			>
				<span
					>{m.library_sort_button()}: {sortLabels[sortField]()}
					{sortDir === 'asc' ? '↑' : '↓'}</span
				><span aria-hidden="true">✕</span>
			</button>
		{/if}
	</div>
{/if}

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

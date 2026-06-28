<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { goto, invalidateAll } from '$app/navigation';
	import { page, navigating } from '$app/state';
	import PosterCard from '$lib/components/PosterCard.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	const selected = new SvelteSet<number>();
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let jobId = $state<number | null>(null);

	// Bulk-action state: in-flight guard, last error, and a confirm gate for the
	// destructive auto-apply (it writes covers straight to the live server).
	let busy = $state(false);
	let errorMsg = $state<string | null>(null);
	let confirmApply = $state(false);
	// Dry-run preview of the pending bulk apply (computed when the confirm gate opens).
	let applyPreview = $state<{
		serverUploads: number;
		childUploads: number;
		kometaExports: number;
		skipped: number;
	} | null>(null);
	let previewing = $state(false);

	// Dim the grid while a library filter/sort round-trip is in flight, so the user
	// gets honest feedback that their change registered. Other navigations don't dim.
	const libraryNavigating = $derived(!!navigating.to && navigating.to.url.pathname === '/library');

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

	// --- Ignore: per-item toggle + client-side filter ---------------------------
	// Each row carries a server `ignored` flag; we keep optimistic overrides locally
	// so a toggle reflects instantly without a round-trip. An override always agrees
	// with the DB once its request resolves, so it stays valid across filter/sort
	// navigations (the reloaded rows carry the same value).
	const ignoreOverrides = new SvelteMap<number, boolean>();
	let ignoreError = $state<string | null>(null);

	function isIgnored(item: (typeof data.items)[number]): boolean {
		return ignoreOverrides.get(item.id) ?? !!item.ignored;
	}

	async function toggleIgnore(item: (typeof data.items)[number]) {
		const id = item.id;
		const prev = isIgnored(item);
		const next = !prev;
		ignoreOverrides.set(id, next); // optimistic
		ignoreError = null;
		try {
			const res = await fetch(`/api/items/${id}/ignore`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ignored: next })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			ignoreOverrides.set(id, prev); // roll back to the last known state
			ignoreError = m.library_action_failed();
		}
	}

	// Client-side "All / Active / Ignored" view over the loaded rows (persisted).
	type IgnoreView = 'all' | 'active' | 'ignored';
	const ignoreViews = [
		{ value: 'all', label: m.library_ignore_all },
		{ value: 'active', label: m.library_ignore_active },
		{ value: 'ignored', label: m.library_ignore_ignored }
	] as const;
	let ignoreView = $state<IgnoreView>('all');
	$effect(() => {
		const saved = localStorage.getItem('pp_ignoreview');
		if (saved === 'all' || saved === 'active' || saved === 'ignored') ignoreView = saved;
	});
	function setIgnoreView(view: IgnoreView) {
		ignoreView = view;
		localStorage.setItem('pp_ignoreview', view);
	}

	const visibleItems = $derived(
		data.items.filter((item) => {
			if (ignoreView === 'all') return true;
			return ignoreView === 'ignored' ? isIgnored(item) : !isIgnored(item);
		})
	);

	// Sort field + direction. Title ascends by default; other fields descend.
	function defaultDir(sort: string | undefined): 'asc' | 'desc' {
		return sort === 'title' || sort === undefined ? 'asc' : 'desc';
	}
	// svelte-ignore state_referenced_locally
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
		setIgnoreView('all');
		goto('/library', { keepFocus: true, noScroll: true });
	}

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		// The selection changed, so a pending confirm/error no longer matches it.
		confirmApply = false;
		applyPreview = null;
		errorMsg = null;
	}
	function clearSelection() {
		selected.clear();
		confirmApply = false;
		applyPreview = null;
		errorMsg = null;
	}

	/**
	 * Open the apply confirm gate and fetch a dry-run preview of what would be written
	 * (server uploads, Kometa exports, skipped child slots) so the user confirms with
	 * full knowledge. The preview is best-effort: if it fails, the confirm still works.
	 */
	async function startApplyPreview() {
		confirmApply = true;
		applyPreview = null;
		previewing = true;
		try {
			const res = await fetch('/api/apply/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemIds: [...selected], method, selection: 'auto' })
			});
			if (res.ok) applyPreview = (await res.json()).plan ?? null;
		} catch {
			// best-effort preview; ignore and let the user confirm without it
		} finally {
			previewing = false;
		}
	}

	/**
	 * Fire a bulk action. Guards against double-submit, keeps the selection on
	 * failure (so the user can retry), and only clears it once a job is queued.
	 */
	async function bulk(path: string, extra: Record<string, unknown> = {}) {
		if (busy) return;
		busy = true;
		errorMsg = null;
		try {
			const res = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemIds: [...selected], ...extra })
			});
			if (!res.ok) throw new Error(String(res.status));
			const { jobId: id } = await res.json();
			jobId = id;
			clearSelection();
		} catch {
			errorMsg = m.library_action_failed();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{m.library_title()} · PosterPilot</title></svelte:head>

<div class="flex items-center justify-between">
	<h1 class="text-2xl font-semibold tracking-tight">{m.library_title()}</h1>
	<span class="text-sm text-neutral-400"
		>{m.library_item_count({ count: visibleItems.length })}</span
	>
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
			type="search"
			value={data.filter.q ?? ''}
			placeholder={m.library_search_placeholder()}
			aria-label={m.library_search_placeholder()}
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

	<!-- Ignored view: client-side All / Active / Ignored over the loaded rows. -->
	<div
		role="group"
		aria-label={m.library_ignore_filter_label()}
		class="inline-flex divide-x divide-neutral-800 overflow-hidden rounded-md border border-neutral-700"
	>
		{#each ignoreViews as view (view.value)}
			<button
				type="button"
				onclick={() => setIgnoreView(view.value)}
				aria-pressed={ignoreView === view.value}
				class="px-2.5 py-2 text-xs font-medium transition-colors {ignoreView === view.value
					? 'bg-accent-600 text-white'
					: 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
			>
				{view.label()}
			</button>
		{/each}
	</div>

	<button
		type="button"
		onclick={toggleAuto}
		title={m.library_autoapply()}
		aria-label={m.library_autoapply()}
		aria-pressed={autoApply}
		class="btn px-2.5 py-2 {autoApply ? 'btn-accent' : 'btn-ghost text-neutral-400'}"
	>
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
			<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
		</svg>
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

{#if ignoreError}
	<div
		role="alert"
		class="mt-3 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300"
	>
		{ignoreError}
	</div>
{/if}

{#if selected.size > 0}
	<div
		class="surface sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-3 border-accent-800 bg-accent-950/40 px-4 py-2 text-sm backdrop-blur"
		aria-busy={busy}
	>
		<span class="font-medium">{m.library_selected_count({ count: selected.size })}</span>
		<button disabled={busy} onclick={() => bulk('/api/discover')} class="btn btn-subtle px-3 py-1">
			{busy ? m.item_working() : m.library_find_covers()}
		</button>
		<select bind:value={method} aria-label={m.library_apply_method_label()} class="input py-1">
			<option value="both">{m.library_method_both()}</option>
			<option value="plex">{m.library_method_plex()}</option>
			<option value="kometa">{m.library_method_kometa()}</option>
		</select>
		{#if confirmApply}
			<!-- Two-step confirm: auto-apply writes to the live server and is hard to undo. -->
			<span class="text-neutral-200">{m.library_apply_confirm({ count: selected.size })}</span>
			<!-- Dry-run preview of what this apply would write, so the confirm is informed. -->
			<span class="text-xs text-neutral-400">
				{#if previewing}
					{m.library_preview_calculating()}
				{:else if applyPreview}
					{m.library_preview_summary({
						uploads: applyPreview.serverUploads + applyPreview.childUploads,
						exports: applyPreview.kometaExports,
						skipped: applyPreview.skipped
					})}
				{/if}
			</span>
			<button
				disabled={busy}
				onclick={() => bulk('/api/apply', { method, selection: 'auto' })}
				class="btn btn-accent px-3 py-1"
			>
				{busy ? m.item_working() : m.library_apply_confirm_yes()}
			</button>
			<button
				disabled={busy}
				onclick={() => {
					confirmApply = false;
					applyPreview = null;
				}}
				class="btn btn-ghost px-3 py-1"
			>
				{m.jobs_cancel()}
			</button>
		{:else}
			<button disabled={busy} onclick={startApplyPreview} class="btn btn-accent px-3 py-1"
				>{m.library_apply_auto()}</button
			>
		{/if}
		<button onclick={clearSelection} class="ml-auto text-neutral-400 hover:text-neutral-200"
			>{m.library_clear()}</button
		>
	</div>
	{#if errorMsg}
		<div
			role="alert"
			class="mt-2 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300"
		>
			{errorMsg}
		</div>
	{/if}
{/if}

{#if jobId}
	<div class="mt-4"><JobProgress {jobId} onDone={() => invalidateAll()} /></div>
{/if}

{#if data.items.length === 0}
	<div class="surface mt-10 p-10 text-center">
		<p class="font-medium text-neutral-200">{m.library_empty_title()}</p>
		<p class="mx-auto mt-1 max-w-md text-sm text-neutral-400">{m.library_empty()}</p>
		<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
			<a href="/settings" class="btn btn-subtle px-3 py-1.5">{m.nav_settings()}</a>
			<a href="/" class="btn btn-ghost px-3 py-1.5">{m.nav_dashboard()}</a>
		</div>
	</div>
{:else if visibleItems.length === 0}
	<div class="surface mt-10 p-10 text-center">
		<p class="text-sm text-neutral-400">{m.library_no_match()}</p>
		<button
			type="button"
			onclick={() => setIgnoreView('all')}
			class="btn btn-ghost mt-4 px-3 py-1.5"
		>
			{m.library_ignore_all()}
		</button>
	</div>
{:else}
	<div
		class="mt-4 grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 {libraryNavigating
			? 'opacity-50'
			: ''}"
		aria-busy={libraryNavigating}
	>
		{#each visibleItems as item (item.id)}
			{@const ignored = isIgnored(item)}
			<div class="group/wrap relative">
				<!-- Dim only the card; the badge + toggle live outside this layer so they stay crisp. -->
				<div class="transition-[opacity,filter] {ignored ? 'opacity-40 saturate-50' : ''}">
					<PosterCard
						{item}
						selectable
						selected={selected.has(item.id)}
						onToggle={() => toggle(item.id)}
					/>
				</div>

				{#if ignored}
					<!-- State is shown three ways (dim + label + icon), never on color alone. -->
					<span
						class="badge badge-muted pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 backdrop-blur-sm"
					>
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path
								d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
							/>
							<line x1="1" y1="1" x2="23" y2="23" />
						</svg>
						{m.poster_badge_ignored()}
					</span>
				{/if}

				<!-- Ignore toggle (bottom-right, clear of the select checkbox + rating). -->
				<button
					type="button"
					onclick={() => toggleIgnore(item)}
					aria-pressed={ignored}
					aria-label={ignored ? m.poster_unignore() : m.poster_ignore()}
					title={ignored ? m.poster_unignore() : m.poster_ignore()}
					class="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded border transition {ignored
						? 'border-accent-400 bg-accent-600 text-white'
						: 'border-neutral-600 bg-neutral-900/80 text-neutral-300 opacity-0 group-focus-within/wrap:opacity-100 group-hover/wrap:opacity-100 hover:border-neutral-400 focus-visible:opacity-100 pointer-coarse:opacity-100'}"
				>
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
						<path
							d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
						/>
						<line x1="1" y1="1" x2="23" y2="23" />
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

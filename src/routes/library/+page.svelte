<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { goto, invalidateAll } from '$app/navigation';
	import { page, navigating } from '$app/state';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import LibraryGrid from '$lib/components/library/LibraryGrid.svelte';
	import LibrarySpotlight from '$lib/components/library/LibrarySpotlight.svelte';
	import LibraryToolbar from '$lib/components/library/LibraryToolbar.svelte';
	import { m } from '$lib/paraglide/messages';
	import { defaultSortDir, type LibrarySort } from '$lib/library-sort';
	import { toasts } from '$lib/stores/toasts.svelte';

	let { data } = $props();

	const selected = new SvelteSet<number>();
	let selectionMode = $state<'explicit' | 'all_matching'>('explicit');
	let allMatchingFingerprint = $state<string | null>(null);
	let allMatchingCount = $state(0);
	let selectingAll = $state(false);
	const selectedCount = $derived(
		selectionMode === 'all_matching' ? allMatchingCount : selected.size
	);
	function isSelected(id: number): boolean {
		return selectionMode === 'all_matching' || selected.has(id);
	}
	// svelte-ignore state_referenced_locally
	let method = $state<'plex' | 'kometa' | 'both'>(data.defaultApplyMethod);
	let jobId = $state<number | null>(null);

	// Bulk-action state: in-flight guard, last error, and a confirm gate for the
	// destructive auto-apply (it writes covers straight to the live server).
	let busy = $state(false);
	let errorMsg = $state<string | null>(null);
	let confirmApply = $state(false);
	// Exact, confirmation-bearing preview of the pending bulk apply.
	let applyPreview = $state<{
		planId: string | null;
		digest: string | null;
		summary: {
			operationCount: number;
			skipCount: number;
			destinations: { server: number; kometa: number };
		};
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

	// --- Ignore: per-item toggle + server-side filter ---------------------------
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
			await invalidateAll();
			toasts.success(next ? m.library_item_ignored() : m.library_item_restored());
		} catch {
			ignoreOverrides.set(id, prev); // roll back to the last known state
			ignoreError = m.library_action_failed();
		}
	}

	// Server-side "All / Active / Ignored" view. Keeping it in the URL means
	// counts, pagination, bulk scope, reloads, and shared links agree.
	type IgnoreView = 'all' | 'active' | 'ignored';
	const ignoreView = $derived<IgnoreView>(data.filter.ignored ?? 'all');
	function setIgnoreView(view: IgnoreView) {
		navigate({ ignored: view === 'all' ? undefined : view });
	}

	// Accumulated server rows (first page from SSR, more appended on scroll). Re-seeded
	// whenever a new SSR payload arrives (a filter/sort change navigates and reloads).
	// svelte-ignore state_referenced_locally
	let items = $state(data.items);
	// svelte-ignore state_referenced_locally
	let total = $state(data.total);
	let loadingMore = $state(false);
	let loadError = $state(false);
	$effect(() => {
		// Depend on the server payload; reset the accumulator when it changes.
		items = data.items;
		total = data.total;
	});

	// More server rows exist beyond what we've loaded under the complete server filter.
	const hasMore = $derived(items.length < total);

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		loadError = false;
		try {
			const params = new URLSearchParams(page.url.searchParams);
			params.set('offset', String(items.length));
			const res = await fetch(`/api/library?${params.toString()}`);
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as { items: typeof data.items; total: number };
			// Guard against a stale response landing after a filter change reset the list.
			items = [...items, ...body.items];
			total = body.total;
		} catch {
			loadError = true;
		} finally {
			loadingMore = false;
		}
	}

	const visibleItems = $derived(items);

	// Popover open state.
	let filterOpen = $state(false);
	let sortOpen = $state(false);

	// The effective field falls back to the configured default; only an explicit
	// URL sort counts as "active" (chip-worthy), so the default never shows a chip.
	const sortField = $derived(data.filter.sort ?? data.defaultSort);
	const sortDir = $derived(data.filter.dir ?? defaultSortDir(sortField));
	const hasSort = $derived(!!data.filter.sort || sortDir !== defaultSortDir(sortField));

	// How many filter facets (not sort) are currently active — drives the Filter badge.
	const activeFilterCount = $derived(
		(data.filter.type ? 1 : 0) +
			(data.filter.minRating ? 1 : 0) +
			(data.filter.genre ? 1 : 0) +
			(data.filter.hasCandidates ? 1 : 0) +
			(data.filter.hasMediux ? 1 : 0) +
			(data.filter.missingPoster ? 1 : 0) +
			(data.filter.unchanged ? 1 : 0)
	);
	const hasAnyFilter = $derived(activeFilterCount > 0 || !!data.filter.q || !!data.filter.ignored);

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

	function onSearchInput(value: string | undefined) {
		staged.q = value;
		if (!autoApply) return;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => navigate({ q: value }), 400);
	}
	function onSearchSubmit() {
		navigate({ q: staged.q ?? data.filter.q });
	}

	// Sort: selecting a field resets to its natural direction; the toggle flips it.
	// Sort always applies immediately (it's not part of the staged filter set).
	function onSortChange(value: LibrarySort) {
		// Picking the configured default drops both params — back to the pristine
		// state, so the URL stays meaningful if the configured default changes.
		const isDefault = value === data.defaultSort;
		navigate({
			sort: isDefault ? undefined : value,
			dir: isDefault ? undefined : defaultSortDir(value)
		});
	}
	function toggleDir() {
		// Flip from the *rendered* direction so the toggle never drifts from what
		// the user sees, regardless of how the current sort/dir was reached.
		navigate({ sort: data.filter.sort, dir: sortDir === 'asc' ? 'desc' : 'asc' });
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
		staged = {};
		goto('/library', { keepFocus: true, noScroll: true });
	}

	/** Select every eligible card in the currently loaded page/window. */
	function selectPage() {
		selectionMode = 'explicit';
		allMatchingFingerprint = null;
		allMatchingCount = 0;
		for (const item of visibleItems) selected.add(item.id);
		confirmApply = false;
		applyPreview = null;
		errorMsg = null;
	}

	async function selectAllMatching() {
		if (selectingAll || total === 0) return;
		selectingAll = true;
		errorMsg = null;
		try {
			const response = await fetch(`/api/library/selection${page.url.search}`);
			if (!response.ok) throw new Error(String(response.status));
			const result = (await response.json()) as { count: number; fingerprint: string };
			if (!Number.isSafeInteger(result.count) || result.count <= 0 || !result.fingerprint) {
				throw new Error('invalid_selection');
			}
			selected.clear();
			selectionMode = 'all_matching';
			allMatchingCount = result.count;
			allMatchingFingerprint = result.fingerprint;
			confirmApply = false;
			applyPreview = null;
		} catch {
			errorMsg = m.library_select_all_failed();
		} finally {
			selectingAll = false;
		}
	}

	function toggle(id: number) {
		if (selectionMode === 'all_matching') {
			// Leaving an all-results snapshot turns the currently loaded cards into an
			// explicit selection, then applies the requested per-card toggle.
			selectionMode = 'explicit';
			allMatchingFingerprint = null;
			allMatchingCount = 0;
			selected.clear();
			for (const item of visibleItems) selected.add(item.id);
		}
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		// The selection changed, so a pending confirm/error no longer matches it.
		confirmApply = false;
		applyPreview = null;
		errorMsg = null;
	}
	function clearSelection() {
		selected.clear();
		selectionMode = 'explicit';
		allMatchingFingerprint = null;
		allMatchingCount = 0;
		confirmApply = false;
		applyPreview = null;
		errorMsg = null;
	}

	function selectionRequest() {
		return selectionMode === 'all_matching' && allMatchingFingerprint
			? {
					selectionScope: {
						query: page.url.search,
						fingerprint: allMatchingFingerprint
					}
				}
			: { itemIds: [...selected] };
	}

	let lastSelectionQuery = page.url.search;
	$effect(() => {
		const currentQuery = page.url.search;
		if (currentQuery === lastSelectionQuery) return;
		lastSelectionQuery = currentQuery;
		clearSelection();
	});

	/**
	 * Open the apply confirm gate and materialize the exact frozen plan. Confirmation
	 * stays disabled unless the server returns its single-use id and digest.
	 */
	async function startApplyPreview() {
		confirmApply = true;
		applyPreview = null;
		previewing = true;
		try {
			const res = await fetch('/api/apply/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...selectionRequest(), method, selection: 'auto' })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				if (body.error === 'result_set_changed') {
					clearSelection();
					errorMsg = m.library_selection_changed();
					return;
				}
				throw new Error(String(res.status));
			}
			applyPreview = await res.json();
		} catch {
			confirmApply = false;
			errorMsg = m.library_action_failed();
		} finally {
			previewing = false;
		}
	}

	async function confirmFrozenApply() {
		if (!applyPreview?.planId || !applyPreview.digest || busy) return;
		busy = true;
		errorMsg = null;
		try {
			const res = await fetch('/api/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: applyPreview.planId, digest: applyPreview.digest })
			});
			if (!res.ok) throw new Error(String(res.status));
			const { jobId: id } = await res.json();
			jobId = id;
			clearSelection();
			toasts.success(m.library_apply_queued());
		} catch {
			errorMsg = m.library_action_failed();
			confirmApply = false;
			applyPreview = null;
		} finally {
			busy = false;
		}
	}

	/**
	 * Fire a bulk action. Guards against double-submit, keeps the selection on
	 * failure (so the user can retry), and only clears it once a job is queued.
	 */
	async function bulk(
		path: string,
		extra: Record<string, unknown> = {},
		successMessage = m.library_discovery_queued
	) {
		if (busy) return;
		busy = true;
		errorMsg = null;
		try {
			const res = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...selectionRequest(), ...extra })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: { code?: string };
				};
				if (body.error?.code === 'result_set_changed') {
					clearSelection();
					errorMsg = m.library_selection_changed();
					return;
				}
				throw new Error(String(res.status));
			}
			const { jobId: id } = await res.json();
			jobId = id;
			clearSelection();
			toasts.success(successMessage());
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
	<span class="text-sm text-neutral-400">
		{m.library_item_range({ shown: visibleItems.length, total })}
	</span>
</div>

<!-- Spotlight -->
<LibrarySpotlight spotlight={data.spotlight} />

<LibraryToolbar
	filter={data.filter}
	genres={data.genres}
	{sortField}
	{sortDir}
	{hasSort}
	{activeFilterCount}
	{hasAnyFilter}
	{ignoreView}
	{autoApply}
	visibleCount={visibleItems.length}
	{total}
	{selectingAll}
	{ignoreError}
	bind:filterOpen
	bind:sortOpen
	{onSearchInput}
	{onSearchSubmit}
	onSetParam={setParam}
	onApplyStaged={applyStaged}
	{onSortChange}
	onToggleDir={toggleDir}
	onSetIgnoreView={setIgnoreView}
	onToggleAuto={toggleAuto}
	onClearAll={clearAll}
	onSelectPage={selectPage}
	onSelectAllMatching={selectAllMatching}
	onRemoveParam={removeParam}
/>

{#if selectedCount > 0}
	<div
		class="surface sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-3 border-accent-800 bg-accent-950/40 px-4 py-2 text-sm backdrop-blur"
		aria-busy={busy}
	>
		<span class="font-medium">{m.library_selected_count({ count: selectedCount })}</span>
		{#if selectionMode === 'all_matching'}
			<span class="badge badge-info">{m.library_selection_exact_snapshot()}</span>
		{/if}
		<button disabled={busy} onclick={() => bulk('/api/discover')} class="btn btn-subtle px-3 py-1">
			{busy ? m.item_working() : m.library_find_covers()}
		</button>
		<select
			bind:value={method}
			onchange={() => {
				confirmApply = false;
				applyPreview = null;
			}}
			aria-label={m.library_apply_method_label()}
			class="input py-1"
		>
			<option value="both">{m.library_method_both()}</option>
			<option value="plex">{m.library_method_plex()}</option>
			<option value="kometa">{m.library_method_kometa()}</option>
		</select>
		{#if confirmApply}
			<!-- Two-step confirm: auto-apply writes to the live server and is hard to undo. -->
			<span class="text-neutral-200">{m.library_apply_confirm({ count: selectedCount })}</span>
			<!-- Dry-run preview of what this apply would write, so the confirm is informed. -->
			<span class="text-xs text-neutral-400">
				{#if previewing}
					{m.library_preview_calculating()}
				{:else if applyPreview}
					{m.library_preview_summary({
						uploads: applyPreview.summary.destinations.server,
						exports: applyPreview.summary.destinations.kometa,
						skipped: applyPreview.summary.skipCount
					})}
				{/if}
			</span>
			<button
				disabled={busy || !applyPreview?.planId || !applyPreview.digest}
				onclick={confirmFrozenApply}
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

<LibraryGrid
	items={visibleItems}
	{total}
	{hasAnyFilter}
	{hasSort}
	{ignoreView}
	{libraryNavigating}
	{loadingMore}
	{hasMore}
	{loadError}
	{isIgnored}
	{isSelected}
	hrefFor={(id) =>
		`/item/${id}?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`}
	onToggle={toggle}
	onToggleIgnore={toggleIgnore}
	onSetIgnoreView={setIgnoreView}
	onLoadMore={loadMore}
/>

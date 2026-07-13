<script lang="ts">
	import Popover from '$lib/components/Popover.svelte';
	import type { LibraryFilterParsed } from '$lib/library-filter';
	import { LIBRARY_SORTS, type LibrarySort, type SortDir } from '$lib/library-sort';
	import { m } from '$lib/paraglide/messages';
	import { sortLabels } from '$lib/sort-labels';

	type IgnoreView = 'all' | 'active' | 'ignored';

	let {
		filter,
		genres,
		sortField,
		sortDir,
		hasSort,
		activeFilterCount,
		hasAnyFilter,
		ignoreView,
		autoApply,
		visibleCount,
		total,
		selectingAll,
		ignoreError,
		filterOpen = $bindable(false),
		sortOpen = $bindable(false),
		onSearchInput,
		onSearchSubmit,
		onSetParam,
		onApplyStaged,
		onSortChange,
		onToggleDir,
		onSetIgnoreView,
		onToggleAuto,
		onClearAll,
		onSelectPage,
		onSelectAllMatching,
		onRemoveParam
	}: {
		filter: LibraryFilterParsed;
		genres: string[];
		sortField: LibrarySort;
		sortDir: SortDir;
		hasSort: boolean;
		activeFilterCount: number;
		hasAnyFilter: boolean;
		ignoreView: IgnoreView;
		autoApply: boolean;
		visibleCount: number;
		total: number;
		selectingAll: boolean;
		ignoreError: string | null;
		filterOpen?: boolean;
		sortOpen?: boolean;
		onSearchInput: (value: string | undefined) => void;
		onSearchSubmit: () => void;
		onSetParam: (key: string, value: string | undefined) => void;
		onApplyStaged: () => void;
		onSortChange: (sort: LibrarySort) => void;
		onToggleDir: () => void;
		onSetIgnoreView: (view: IgnoreView) => void;
		onToggleAuto: () => void;
		onClearAll: () => void;
		onSelectPage: () => void;
		onSelectAllMatching: () => void;
		onRemoveParam: (...keys: string[]) => void;
	} = $props();

	const typeLabels: Record<string, () => string> = {
		movie: m.library_type_movies,
		show: m.library_type_shows
	};
	const ignoreViews = [
		{ value: 'all', label: m.library_ignore_all },
		{ value: 'active', label: m.library_ignore_active },
		{ value: 'ignored', label: m.library_ignore_ignored }
	] as const;

	function valueFrom(event: Event): string | undefined {
		return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value || undefined;
	}
</script>

<div class="mt-4 flex flex-wrap items-center gap-2 text-sm">
	<form
		onsubmit={(event) => {
			event.preventDefault();
			onSearchSubmit();
		}}
	>
		<input
			name="q"
			type="search"
			value={filter.q ?? ''}
			placeholder={m.library_search_placeholder()}
			aria-label={m.library_search_placeholder()}
			oninput={(event) => onSearchInput(valueFrom(event))}
			class="input w-44"
		/>
	</form>

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
				<select
					value={filter.type ?? ''}
					onchange={(event) => onSetParam('type', valueFrom(event))}
					class="input w-full"
				>
					<option value="">{m.library_all_types()}</option>
					<option value="movie">{m.library_type_movies()}</option>
					<option value="show">{m.library_type_shows()}</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.library_filter_min_rating()}</span>
				<select
					value={filter.minRating?.toString() ?? ''}
					onchange={(event) => onSetParam('minRating', valueFrom(event))}
					class="input w-full"
				>
					<option value="">{m.library_any_rating()}</option>
					<option value="6">{m.library_rating_6()}</option>
					<option value="7">{m.library_rating_7()}</option>
					<option value="8">{m.library_rating_8()}</option>
					<option value="9">{m.library_rating_9()}</option>
				</select>
			</label>
			{#if genres.length}
				<label class="block">
					<span class="mb-1 block text-xs text-neutral-400">{m.library_filter_genre()}</span>
					<select
						value={filter.genre ?? ''}
						onchange={(event) => onSetParam('genre', valueFrom(event))}
						class="input w-full"
					>
						<option value="">{m.library_all_genres()}</option>
						{#each genres as genre (genre)}<option value={genre}>{genre}</option>{/each}
					</select>
				</label>
			{/if}
			<div class="space-y-1.5 border-t border-neutral-800 pt-2">
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={filter.hasCandidates}
						onchange={(event) =>
							onSetParam(
								'covers',
								(event.currentTarget as HTMLInputElement).checked ? '1' : undefined
							)}
					/>
					{m.library_filter_candidates()}
				</label>
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={filter.hasMediux}
						onchange={(event) =>
							onSetParam(
								'mediux',
								(event.currentTarget as HTMLInputElement).checked ? '1' : undefined
							)}
					/>
					{m.library_filter_mediux()}
				</label>
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={filter.missingPoster}
						onchange={(event) =>
							onSetParam(
								'missing',
								(event.currentTarget as HTMLInputElement).checked ? '1' : undefined
							)}
					/>
					{m.library_filter_missing()}
				</label>
				<label class="flex items-center gap-2 text-neutral-300">
					<input
						type="checkbox"
						checked={filter.unchanged}
						onchange={(event) =>
							onSetParam(
								'unchanged',
								(event.currentTarget as HTMLInputElement).checked ? '1' : undefined
							)}
					/>
					{m.library_filter_unchanged()}
				</label>
			</div>
			{#if !autoApply}
				<button type="button" class="btn btn-subtle w-full" onclick={onApplyStaged}>
					{m.library_apply_filters()}
				</button>
			{/if}
		</div>
	</Popover>

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
				<select
					value={sortField}
					onchange={(event) => onSortChange(valueFrom(event) as LibrarySort)}
					class="input w-full"
				>
					{#each LIBRARY_SORTS as sort (sort)}
						<option value={sort}>{sortLabels[sort]()}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				onclick={onToggleDir}
				class="btn btn-ghost w-full justify-between"
				aria-label={m.library_sort_dir()}
			>
				<span>{m.library_sort_dir()}</span>
				<span>{sortDir === 'asc' ? `↑ ${m.library_sort_asc()}` : `↓ ${m.library_sort_desc()}`}</span
				>
			</button>
		</div>
	</Popover>

	<div
		role="group"
		aria-label={m.library_ignore_filter_label()}
		class="inline-flex divide-x divide-neutral-800 overflow-hidden rounded-md border border-neutral-700"
	>
		{#each ignoreViews as view (view.value)}
			<button
				type="button"
				onclick={() => onSetIgnoreView(view.value)}
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
		onclick={onToggleAuto}
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
		<button type="button" onclick={onClearAll} class="text-neutral-400 hover:text-neutral-200">
			{m.library_clear_all()}
		</button>
	{/if}

	{#if visibleCount > 0}
		<button type="button" onclick={onSelectPage} class="btn btn-ghost px-2.5 py-2 text-xs">
			{m.library_select_page()}
		</button>
		<button
			type="button"
			disabled={selectingAll}
			onclick={onSelectAllMatching}
			class="btn btn-ghost px-2.5 py-2 text-xs"
		>
			{selectingAll ? m.library_selecting_all() : m.library_select_all_matching({ count: total })}
		</button>
	{/if}
</div>

{#if hasAnyFilter || hasSort}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if filter.q}
			<button type="button" onclick={() => onRemoveParam('q')} class="chip chip-active gap-1">
				<span>“{filter.q}”</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.type}
			<button type="button" onclick={() => onRemoveParam('type')} class="chip chip-active gap-1">
				<span>{typeLabels[filter.type]()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.minRating}
			<button
				type="button"
				onclick={() => onRemoveParam('minRating')}
				class="chip chip-active gap-1"
			>
				<span>★ ≥ {filter.minRating}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.genre}
			<button type="button" onclick={() => onRemoveParam('genre')} class="chip chip-active gap-1">
				<span>{filter.genre}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.hasMediux}
			<button type="button" onclick={() => onRemoveParam('mediux')} class="chip chip-active gap-1">
				<span>{m.library_filter_mediux()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.hasCandidates}
			<button type="button" onclick={() => onRemoveParam('covers')} class="chip chip-active gap-1">
				<span>{m.library_filter_candidates()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.missingPoster}
			<button type="button" onclick={() => onRemoveParam('missing')} class="chip chip-active gap-1">
				<span>{m.library_filter_missing()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if filter.unchanged}
			<button
				type="button"
				onclick={() => onRemoveParam('unchanged')}
				class="chip chip-active gap-1"
			>
				<span>{m.library_filter_unchanged()}</span><span aria-hidden="true">✕</span>
			</button>
		{/if}
		{#if hasSort}
			<button
				type="button"
				onclick={() => onRemoveParam('sort', 'dir')}
				class="chip chip-active gap-1"
			>
				<span>
					{m.library_sort_button()}: {sortLabels[sortField]()}
					{sortDir === 'asc' ? '↑' : '↓'}
				</span>
				<span aria-hidden="true">✕</span>
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

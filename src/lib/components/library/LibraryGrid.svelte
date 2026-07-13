<script lang="ts">
	import PosterCard from '$lib/components/PosterCard.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { isPosterGridKey, nextPosterGridIndex } from '$lib/library-grid-navigation';
	import { m } from '$lib/paraglide/messages';
	import type { LibraryListItem } from '$lib/server/queries';

	type IgnoreView = 'all' | 'active' | 'ignored';

	let {
		items,
		total,
		hasAnyFilter,
		hasSort,
		ignoreView,
		libraryNavigating,
		loadingMore,
		hasMore,
		loadError,
		isIgnored,
		isSelected,
		hrefFor,
		onToggle,
		onToggleIgnore,
		onSetIgnoreView,
		onLoadMore
	}: {
		items: LibraryListItem[];
		total: number;
		hasAnyFilter: boolean;
		hasSort: boolean;
		ignoreView: IgnoreView;
		libraryNavigating: boolean;
		loadingMore: boolean;
		hasMore: boolean;
		loadError: boolean;
		isIgnored: (item: LibraryListItem) => boolean;
		isSelected: (id: number) => boolean;
		hrefFor: (id: number) => string;
		onToggle: (id: number) => void;
		onToggleIgnore: (item: LibraryListItem) => void;
		onSetIgnoreView: (view: IgnoreView) => void;
		onLoadMore: () => void;
	} = $props();

	let grid = $state<HTMLDivElement | null>(null);

	function onVisible(node: HTMLElement, callback: () => void) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) callback();
			},
			{ rootMargin: '600px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	function onGridKeyDown(event: KeyboardEvent) {
		if (!grid || event.altKey || event.ctrlKey || event.metaKey || !isPosterGridKey(event.key)) {
			return;
		}
		const currentLink = (event.target as HTMLElement).closest<HTMLAnchorElement>(
			'[data-poster-card-link]'
		);
		if (!currentLink || !grid.contains(currentLink)) return;

		const links = Array.from(grid.querySelectorAll<HTMLAnchorElement>('[data-poster-card-link]'));
		const current = links.indexOf(currentLink);
		if (current < 0) return;
		const renderedColumns = getComputedStyle(grid)
			.gridTemplateColumns.split(' ')
			.filter(Boolean).length;
		const next = nextPosterGridIndex(current, event.key, renderedColumns, links.length);
		if (next === current || next < 0) return;
		event.preventDefault();
		links[next]?.focus();
	}
</script>

<section aria-busy={libraryNavigating || loadingMore} aria-label={m.library_title()}>
	{#if libraryNavigating}
		<p class="sr-only" role="status">{m.library_loading_more()}</p>
		<div
			class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
			aria-hidden="true"
		>
			{#each Array(16) as _, index (index)}
				<div class="space-y-2">
					<Skeleton class="aspect-[2/3] w-full rounded-lg" />
					<Skeleton class="h-3 w-4/5 rounded" />
				</div>
			{/each}
		</div>
	{:else if total === 0 && !hasAnyFilter && !hasSort && ignoreView === 'all'}
		<div class="surface mt-10 p-10 text-center">
			<p class="font-medium text-neutral-200">{m.library_empty_title()}</p>
			<p class="mx-auto mt-1 max-w-md text-sm text-neutral-400">{m.library_empty()}</p>
			<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
				<a href="/settings" class="btn btn-subtle px-3 py-1.5">{m.nav_settings()}</a>
				<a href="/" class="btn btn-ghost px-3 py-1.5">{m.nav_dashboard()}</a>
			</div>
		</div>
	{:else if total === 0 || items.length === 0}
		<div class="surface mt-10 p-10 text-center">
			<p class="text-sm text-neutral-400">{m.library_no_match()}</p>
			{#if ignoreView !== 'all'}
				<button
					type="button"
					onclick={() => onSetIgnoreView('all')}
					class="btn btn-ghost mt-4 px-3 py-1.5"
				>
					{m.library_ignore_all()}
				</button>
			{/if}
		</div>
	{:else}
		<div
			bind:this={grid}
			onkeydown={onGridKeyDown}
			role="grid"
			tabindex="-1"
			class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
		>
			{#each items as item (item.id)}
				{@const ignored = isIgnored(item)}
				<div role="row" class="group/wrap relative">
					<div role="gridcell">
						<div class="transition-[opacity,filter] {ignored ? 'opacity-40 saturate-50' : ''}">
							<PosterCard
								{item}
								href={hrefFor(item.id)}
								selectable
								selected={isSelected(item.id)}
								onToggle={() => onToggle(item.id)}
							/>
						</div>

						{#if ignored}
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

						<button
							type="button"
							onclick={() => onToggleIgnore(item)}
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
				</div>
			{/each}
		</div>

		{#if loadingMore}
			<div
				class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
				aria-hidden="true"
			>
				{#each Array(8) as _, index (index)}
					<Skeleton class="aspect-[2/3] w-full rounded-lg" />
				{/each}
			</div>
		{/if}
		{#if hasMore}
			<div use:onVisible={onLoadMore} class="mt-6 flex justify-center">
				<button type="button" onclick={onLoadMore} disabled={loadingMore} class="btn btn-ghost">
					{loadingMore ? m.library_loading_more() : m.library_load_more()}
				</button>
			</div>
		{/if}
		{#if loadError}
			<p class="mt-3 text-center text-sm text-red-300" role="alert">{m.library_load_error()}</p>
		{/if}
	{/if}
</section>

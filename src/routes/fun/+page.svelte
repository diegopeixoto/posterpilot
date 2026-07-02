<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Each submit stamps a fresh nonce into `pick` so re-rolling with unchanged
	// filters is still a new URL → the load function draws again.
	function stampNonce(e: SubmitEvent) {
		const pick = (e.currentTarget as HTMLFormElement).elements.namedItem('pick');
		if (pick instanceof HTMLInputElement) pick.value = Date.now().toString(36);
	}
</script>

<svelte:head>
	<title>{m.fun_title()} · PosterPilot</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-8">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight text-white">{m.fun_picker_title()}</h1>
		<p class="mt-1 text-sm text-neutral-400">{m.fun_picker_subtitle()}</p>
	</header>

	<form method="GET" action="/fun" onsubmit={stampNonce} class="surface space-y-4 p-4">
		<input type="hidden" name="pick" value="1" />
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_type_label()}</span>
				<select name="type" value={data.filter.type ?? ''} class="input w-full">
					<option value="">{m.fun_type_both()}</option>
					<option value="movie">{m.library_type_movies()}</option>
					<option value="show">{m.library_type_shows()}</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_genre_label()}</span>
				<select name="genre" value={data.filter.genre ?? ''} class="input w-full">
					<option value="">{m.fun_genre_all()}</option>
					{#each data.genres as genre (genre)}
						<option value={genre}>{genre}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_year_min()}</span>
				<input
					type="number"
					name="yearMin"
					inputmode="numeric"
					min="1"
					value={data.filter.yearMin ?? ''}
					placeholder="1990"
					class="input w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_year_max()}</span>
				<input
					type="number"
					name="yearMax"
					inputmode="numeric"
					min="1"
					value={data.filter.yearMax ?? ''}
					placeholder="2025"
					class="input w-full"
				/>
			</label>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<label class="flex items-center gap-2 text-sm text-neutral-300">
				<input
					type="checkbox"
					name="excludeWatched"
					value="1"
					checked={data.filter.excludeWatched}
				/>
				{m.fun_exclude_watched()}
			</label>
			<button type="submit" class="btn btn-accent">
				{data.picking ? m.fun_reroll_button() : m.fun_pick_button()}
			</button>
		</div>
	</form>

	{#if data.picked}
		<article class="surface relative overflow-hidden">
			{#if data.picked.backdropUrl}
				<img
					src={data.picked.backdropUrl}
					alt=""
					class="absolute inset-0 h-full w-full object-cover opacity-25"
				/>
				<div
					class="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/80 to-neutral-950/40"
				></div>
			{/if}
			<div class="relative flex flex-col gap-6 p-6 sm:flex-row">
				<div
					class="w-40 shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-lg sm:w-48"
				>
					<div class="aspect-[2/3] w-full">
						{#if data.picked.currentPosterUrl}
							<img
								src={data.picked.currentPosterUrl}
								alt={data.picked.title}
								class="h-full w-full object-cover"
							/>
						{:else}
							<div class="flex h-full items-center justify-center text-xs text-neutral-400">
								{m.poster_no_poster()}
							</div>
						{/if}
					</div>
				</div>
				<div class="min-w-0 space-y-3">
					<div>
						<h2 class="text-xl font-semibold tracking-tight text-white">{data.picked.title}</h2>
						<p class="mt-1 text-sm text-neutral-400">
							{data.picked.year ?? '—'} ·
							{data.picked.type === 'movie' ? m.library_type_movies() : m.library_type_shows()}
							{#if data.picked.rating}
								· <span class="text-amber-300">★ {data.picked.rating.toFixed(1)}</span>
							{/if}
						</p>
					</div>
					{#if data.picked.genres?.length}
						<div class="flex flex-wrap gap-1.5">
							{#each data.picked.genres as genre (genre)}
								<span class="chip">{genre}</span>
							{/each}
						</div>
					{/if}
					{#if data.picked.overview}
						<p class="line-clamp-4 max-w-prose text-sm text-neutral-300">{data.picked.overview}</p>
					{/if}
					<div class="pt-1">
						<a href={`/item/${data.picked.id}`} class="btn btn-ghost">{m.fun_view_item()}</a>
					</div>
				</div>
			</div>
		</article>
	{:else if data.picking}
		<div class="surface p-10 text-center text-sm text-neutral-400">{m.fun_empty()}</div>
	{/if}
</div>

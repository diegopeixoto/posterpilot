<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const revealed = new SvelteSet<number>();
	let copied = $state(false);
	let revealMessage = $state('');

	function stampNonce(e: SubmitEvent) {
		const pick = (e.currentTarget as HTMLFormElement).elements.namedItem('pick');
		if (pick instanceof HTMLInputElement) pick.value = Date.now().toString(36);
	}

	function errorText(field: keyof typeof data.errors): string | null {
		const code = data.errors[field];
		if (code === 'min_greater_than_max') return m.fun_error_order();
		if (code === 'out_of_range') return m.fun_error_range();
		if (code === 'invalid') return m.fun_error_invalid();
		return null;
	}

	function isRevealed(id: number): boolean {
		return data.filter.mode === 'standard' || revealed.has(id);
	}

	async function revealChoice(id: number, title: string): Promise<void> {
		revealed.add(id);
		revealMessage = m.fun_choice_revealed({ title });
		await tick();
		document.getElementById(`fun-choice-title-${id}`)?.focus();
	}

	async function copyShareLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			copied = false;
		}
	}

	const exclusionValue = $derived(
		[...data.filter.excludeItemIds, ...data.choices.map((item) => item.id)]
			.filter((id, index, all) => all.indexOf(id) === index)
			.slice(-24)
			.join(',')
	);
</script>

<svelte:head>
	<title>{m.fun_picker_title()} · PosterPilot</title>
</svelte:head>

<section class="space-y-6">
	<header>
		<h2 class="text-xl font-semibold tracking-tight text-white">{m.fun_picker_title()}</h2>
		<p class="mt-1 text-sm text-neutral-400">{m.fun_picker_subtitle()}</p>
	</header>

	<form method="GET" action="/fun" onsubmit={stampNonce} class="surface space-y-5 p-5">
		<input type="hidden" name="pick" value="1" />
		{#if exclusionValue}<input type="hidden" name="exclude" value={exclusionValue} />{/if}

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_preset_label()}</span>
				<select
					name="preset"
					value={data.filter.preset ?? ''}
					aria-label={m.fun_preset_label()}
					class="input w-full"
				>
					<option value="">{m.fun_preset_none()}</option>
					<option value="movie-night">{m.fun_preset_movie_night()}</option>
					<option value="quick-watch">{m.fun_preset_quick()}</option>
					<option value="acclaimed">{m.fun_preset_acclaimed()}</option>
					<option value="fresh-unwatched">{m.fun_preset_fresh()}</option>
				</select>
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_library_label()}</span>
				<select
					name="library"
					value={data.filter.librarySectionKey ?? ''}
					aria-label={m.fun_library_label()}
					class="input w-full"
				>
					<option value="">{m.fun_library_all()}</option>
					{#each data.libraries as library (`${library.key}:${library.type}`)}
						<option value={library.key}>{library.key}</option>
					{/each}
				</select>
				{#if errorText('library')}<span class="mt-1 block text-xs text-red-300"
						>{errorText('library')}</span
					>{/if}
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_type_label()}</span>
				<select
					name="type"
					value={data.filter.type ?? ''}
					aria-label={m.fun_type_label()}
					class="input w-full"
				>
					<option value="">{m.fun_type_both()}</option>
					<option value="movie">{m.library_type_movies()}</option>
					<option value="show">{m.library_type_shows()}</option>
				</select>
				{#if errorText('type')}<span class="mt-1 block text-xs text-red-300"
						>{errorText('type')}</span
					>{/if}
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_genre_label()}</span>
				<select
					name="genre"
					value={data.filter.genre ?? ''}
					aria-label={m.fun_genre_label()}
					class="input w-full"
				>
					<option value="">{m.fun_genre_all()}</option>
					{#each data.genres as genre (genre)}<option value={genre}>{genre}</option>{/each}
				</select>
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_year_min()}</span>
				<input
					type="number"
					name="yearMin"
					inputmode="numeric"
					min={data.bounds.yearMin ?? 1870}
					max={data.bounds.yearMax ?? undefined}
					value={data.filter.yearMin ?? ''}
					placeholder={data.bounds.yearMin?.toString() ?? '1990'}
					class="input w-full"
				/>
				{#if errorText('yearMin')}<span class="mt-1 block text-xs text-red-300"
						>{errorText('yearMin')}</span
					>{/if}
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_year_max()}</span>
				<input
					type="number"
					name="yearMax"
					inputmode="numeric"
					min={data.bounds.yearMin ?? 1870}
					max={data.bounds.yearMax ?? undefined}
					value={data.filter.yearMax ?? ''}
					placeholder={data.bounds.yearMax?.toString() ?? '2026'}
					class="input w-full"
				/>
				{#if errorText('yearMax')}<span class="mt-1 block text-xs text-red-300"
						>{errorText('yearMax')}</span
					>{/if}
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_runtime_max()}</span>
				<input
					type="number"
					name="runtimeMax"
					min={data.bounds.runtimeMin ?? 1}
					max={data.bounds.runtimeMax ?? 1000}
					value={data.filter.runtimeMax ?? ''}
					placeholder={data.bounds.runtimeMax?.toString() ?? '120'}
					class="input w-full"
				/>
				{#if errorText('runtimeMax')}<span class="mt-1 block text-xs text-red-300"
						>{errorText('runtimeMax')}</span
					>{/if}
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_rating_min()}</span>
				<input
					type="number"
					name="ratingMin"
					min="0"
					max="10"
					step="0.1"
					value={data.filter.ratingMin ?? ''}
					placeholder="7.0"
					class="input w-full"
				/>
				{#if errorText('ratingMin')}<span class="mt-1 block text-xs text-red-300"
						>{errorText('ratingMin')}</span
					>{/if}
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_recency_label()}</span>
				<select
					name="addedWithinDays"
					value={data.filter.addedWithinDays ?? ''}
					aria-label={m.fun_recency_label()}
					class="input w-full"
				>
					<option value="">{m.fun_recency_any()}</option>
					<option value="30">{m.fun_recency_30()}</option>
					<option value="90">{m.fun_recency_90()}</option>
					<option value="365">{m.fun_recency_365()}</option>
				</select>
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_choice_count()}</span>
				<select
					name="count"
					value={data.filter.count}
					aria-label={m.fun_choice_count()}
					class="input w-full"
				>
					<option value="1">1</option>
					<option value="2">2</option>
					<option value="3">3</option>
				</select>
			</label>

			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_mode_label()}</span>
				<select
					name="mode"
					value={data.filter.mode}
					aria-label={m.fun_mode_label()}
					class="input w-full"
				>
					<option value="standard">{m.fun_mode_standard()}</option>
					<option value="blind">{m.fun_mode_blind()}</option>
					<option value="capsule">{m.fun_mode_capsule()}</option>
				</select>
			</label>
		</div>

		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-4">
			<div class="space-y-1">
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input
						type="checkbox"
						name="excludeWatched"
						value="1"
						checked={data.filter.excludeWatched}
					/>
					{m.fun_exclude_watched()}
				</label>
				<p class="text-xs text-neutral-500">
					{m.fun_eligible_count({ count: data.eligibleCount })}
				</p>
			</div>
			<button type="submit" class="btn btn-accent">
				{data.picking ? m.fun_reroll_button() : m.fun_pick_button()}
			</button>
		</div>
	</form>
	<p class="sr-only" aria-live="polite" aria-atomic="true">{revealMessage}</p>

	{#if data.choices.length || data.unavailableChoiceIds.length}
		<div class="flex items-center justify-between gap-3">
			<p class="text-sm text-neutral-400">
				{m.fun_result_count({ count: data.choices.length + data.unavailableChoiceIds.length })}
			</p>
			<button type="button" onclick={copyShareLink} class="btn btn-ghost px-3 py-1.5 text-xs">
				{copied ? m.fun_share_copied() : m.fun_share()}
			</button>
		</div>

		<div
			class="grid gap-4 {data.choices.length + data.unavailableChoiceIds.length > 1
				? 'md:grid-cols-2 xl:grid-cols-3'
				: ''}"
		>
			{#each data.choices as item (item.id)}
				{@const open = isRevealed(item.id)}
				<article class="surface group relative overflow-hidden">
					<div class="relative aspect-[2/3] overflow-hidden bg-neutral-950">
						{#if item.hasPoster}
							<img
								src={`/api/poster-thumb/${item.id}?v=${encodeURIComponent(item.posterVersion)}`}
								alt={open ? item.title : ''}
								width="480"
								height="720"
								class="h-full w-full object-cover transition duration-500 {open
									? ''
									: 'scale-105 blur-xl brightness-50'}"
							/>
						{:else}
							<div class="flex h-full items-center justify-center text-sm text-neutral-500">
								{m.poster_no_poster()}
							</div>
						{/if}
						{#if !open}
							<div
								class="absolute inset-0 flex items-center justify-center bg-black/20 p-6 text-center"
							>
								<button
									type="button"
									onclick={() => revealChoice(item.id, item.title)}
									class="btn btn-accent"
								>
									{data.filter.mode === 'capsule' ? m.fun_open_capsule() : m.fun_reveal_choice()}
								</button>
							</div>
						{/if}
					</div>
					<div class="space-y-3 p-4">
						<div>
							<h3
								id={`fun-choice-title-${item.id}`}
								tabindex="-1"
								class="text-lg font-semibold text-white"
							>
								{open ? item.title : m.fun_hidden_title()}
							</h3>
							<p class="mt-0.5 text-sm text-neutral-400">
								{item.type === 'movie' ? m.library_type_movies() : m.library_type_shows()}
								· {item.year ?? '—'} · {item.runtime
									? m.fun_runtime_value({ minutes: item.runtime })
									: '—'}
								{#if item.rating}
									· <span class="text-amber-300">★ {item.rating.toFixed(1)}</span>{/if}
							</p>
						</div>
						{#if item.genres?.length}
							<p class="text-xs text-neutral-400">{item.genres.join(' · ')}</p>
						{/if}
						{#if open}
							{#if item.overview}<p class="line-clamp-3 text-sm text-neutral-300">
									{item.overview}
								</p>{/if}
							<a
								href={`/item/${item.id}?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`}
								class="btn btn-ghost"
							>
								{m.fun_view_item()}
							</a>
						{:else if item.tagline}
							<p class="line-clamp-2 text-sm italic text-neutral-300">“{item.tagline}”</p>
						{/if}
					</div>
				</article>
			{/each}
			{#each data.unavailableChoiceIds as id (id)}
				<article class="surface flex min-h-72 items-center justify-center p-8 text-center">
					<p class="text-sm text-neutral-400">{m.fun_shared_choice_unavailable()}</p>
				</article>
			{/each}
		</div>
	{:else if data.picking && Object.keys(data.errors).length === 0}
		<div class="surface p-10 text-center text-sm text-neutral-400">{m.fun_empty()}</div>
	{:else if Object.keys(data.errors).length > 0}
		<div role="alert" class="surface border-red-900/60 p-4 text-sm text-red-300">
			{m.fun_fix_filters()}
		</div>
	{/if}
</section>

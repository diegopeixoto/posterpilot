<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function stampSeed(e: SubmitEvent) {
		const plan = (e.currentTarget as HTMLFormElement).elements.namedItem('plan');
		if (plan instanceof HTMLInputElement) plan.value = Date.now().toString(36);
	}

	function failureMessage(reason: string): string {
		if (reason === 'invalid-budget') return m.fun_session_invalid_budget();
		if (reason === 'not-enough-known-runtime') return m.fun_session_not_enough();
		return m.fun_session_no_fit();
	}
</script>

<svelte:head><title>{m.fun_session_title()} · PosterPilot</title></svelte:head>

<section class="space-y-6">
	<header>
		<h2 class="text-xl font-semibold tracking-tight text-white">{m.fun_session_title()}</h2>
		<p class="mt-1 text-sm text-neutral-400">{m.fun_session_subtitle()}</p>
	</header>

	<form method="GET" action="/fun/session" onsubmit={stampSeed} class="surface space-y-4 p-5">
		<input type="hidden" name="plan" value="1" />
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_session_budget()}</span>
				<input
					type="number"
					name="budget"
					min="30"
					max="1440"
					step="5"
					value={data.budgetMinutes}
					class="input w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_session_films()}</span>
				<select
					name="films"
					value={data.filmCount}
					aria-label={m.fun_session_films()}
					class="input w-full"
				>
					<option value="2">2</option><option value="3">3</option>
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
				{#if data.errors.ratingMin}
					<span class="mt-1 block text-xs text-red-300">{m.fun_error_range()}</span>
				{/if}
			</label>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-4">
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
			<button type="submit" class="btn btn-accent">
				{data.planning ? m.fun_session_replan() : m.fun_session_plan()}
			</button>
		</div>
	</form>

	{#if data.session?.ok}
		<div
			class="surface flex flex-wrap items-center justify-between gap-3 border-accent-900/70 px-5 py-4"
		>
			<div>
				<p class="font-medium text-white">{m.fun_session_ready()}</p>
				<p class="mt-0.5 text-sm text-neutral-400">
					{m.fun_session_total({
						total: data.session.totalMinutes,
						remaining: data.session.remainingMinutes
					})}
				</p>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.session.items as item, index (item.id)}
				<article class="surface overflow-hidden">
					<div class="relative aspect-[2/3] bg-neutral-950">
						{#if item.hasPoster}
							<img
								src={`/api/poster-thumb/${item.id}?v=${encodeURIComponent(item.posterVersion)}`}
								alt={item.title}
								class="h-full w-full object-cover"
							/>
						{/if}
						<span
							class="absolute top-3 left-3 rounded-full bg-black/80 px-2.5 py-1 text-xs font-semibold text-white"
						>
							{index + 1}
						</span>
					</div>
					<div class="p-4">
						<h3 class="font-semibold text-white">
							<a class="hover:text-accent-200" href={`/item/${item.id}`}>{item.title}</a>
						</h3>
						<p class="mt-1 text-sm text-neutral-400">
							{m.fun_runtime_value({ minutes: item.runtime ?? 0 })} · {item.year ?? '—'}
						</p>
					</div>
				</article>
			{/each}
		</div>
	{:else if data.session && !data.session.ok}
		<div class="surface p-8 text-center">
			<p class="font-medium text-neutral-200">{failureMessage(data.session.reason)}</p>
			<p class="mt-1 text-sm text-neutral-500">{m.fun_session_adjust()}</p>
		</div>
	{/if}
</section>

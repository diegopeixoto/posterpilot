<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PosterCandidate } from '$lib/server/db/schema';
	import type { CandidateSet } from '$lib/server/posters/sets';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	let selectedPoster = $state<string | null>(data.item.selectedPosterUrl);
	let selectedBackground = $state<string | null>(data.item.selectedBackgroundUrl);
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let busy = $state(false);
	let message = $state<string | null>(null);

	let posterUrlInput = $state('');
	let backgroundUrlInput = $state('');
	let posterFile = $state<File | null>(null);

	const isShow = $derived(data.item.type === 'show');

	// Re-sync local selection when navigating to a different item.
	let loadedId = data.item.id;
	$effect(() => {
		if (data.item.id !== loadedId) {
			loadedId = data.item.id;
			selectedPoster = data.item.selectedPosterUrl;
			selectedBackground = data.item.selectedBackgroundUrl;
			message = null;
		}
	});

	function formatRuntime(min: number | null): string | null {
		if (!min) return null;
		const h = Math.floor(min / 60);
		const m = min % 60;
		return h ? `${h}h ${m}m` : `${m}m`;
	}

	// Locale-aware rating number (e.g. 8,5 in pt-BR / es).
	const ratingFmt = $derived(
		new Intl.NumberFormat(data.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
	);

	const metaBits = $derived(
		[
			data.item.rating ? `★ ${ratingFmt.format(data.item.rating)}` : null,
			data.item.year?.toString() ?? null,
			isShow
				? [
						data.item.seasonCount ? m.item_seasons({ count: data.item.seasonCount }) : null,
						data.item.episodeCount ? m.item_episodes({ count: data.item.episodeCount }) : null
					]
						.filter(Boolean)
						.join(' · ') || null
				: formatRuntime(data.item.runtime)
		].filter(Boolean) as string[]
	);

	const enriched = $derived(
		Boolean(data.item.backdropUrl || data.item.overview || (data.item.genres?.length ?? 0))
	);

	function setKinds(set: CandidateSet, kind: PosterCandidate['kind']) {
		return set.candidates.filter((c) => c.kind === kind);
	}

	const PROVIDER_LABELS: Record<string, string> = {
		mediux: 'MediUX',
		tmdb: 'TMDB',
		fanarttv: 'Fanart.tv',
		theposterdb: 'ThePosterDB'
	};
	function providerLabel(id: string): string {
		return PROVIDER_LABELS[id] ?? id;
	}

	/** Persist the current staged poster + background as the pending selection. */
	async function persistSelection() {
		await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ posterUrl: selectedPoster, backgroundUrl: selectedBackground })
		});
	}

	async function pickPoster(url: string) {
		selectedPoster = selectedPoster === url ? null : url;
		await persistSelection();
	}
	async function pickBackground(url: string) {
		selectedBackground = selectedBackground === url ? null : url;
		await persistSelection();
	}

	/** Stage a whole set: its first poster and first backdrop. */
	async function useSet(set: CandidateSet) {
		const poster = setKinds(set, 'poster')[0];
		const backdrop = setKinds(set, 'background')[0];
		if (poster) selectedPoster = poster.url;
		if (backdrop) selectedBackground = backdrop.url;
		await persistSelection();
		message = m.item_msg_set_staged();
	}

	async function useCustomUrl(which: 'poster' | 'background') {
		const url = (which === 'poster' ? posterUrlInput : backgroundUrlInput).trim();
		if (!url) return;
		if (which === 'poster') selectedPoster = url;
		else selectedBackground = url;
		await persistSelection();
	}

	async function discover() {
		busy = true;
		message = null;
		try {
			const res = await fetch(`/api/items/${data.item.id}/discover`, { method: 'POST' });
			const result = await res.json();
			message =
				!res.ok || result.error
					? m.item_msg_discovery_failed({ error: result.error ?? res.status })
					: result.count === 1
						? m.item_msg_found_cover_one({ count: result.count })
						: m.item_msg_found_covers({ count: result.count });
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function uploadPoster() {
		if (!posterFile) return;
		busy = true;
		message = null;
		try {
			const fd = new FormData();
			fd.append('file', posterFile);
			const res = await fetch(`/api/items/${data.item.id}/upload`, { method: 'POST', body: fd });
			const result = await res.json();
			message = result.ok
				? m.item_msg_uploaded()
				: m.item_msg_upload_failed({ error: result.error ?? res.status });
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function revert() {
		busy = true;
		message = null;
		try {
			const res = await fetch(`/api/items/${data.item.id}/revert`, { method: 'POST' });
			const result = await res.json();
			message = result.ok
				? m.item_msg_reverted()
				: m.item_msg_revert_failed({ error: result.error ?? res.status });
			selectedPoster = null;
			selectedBackground = null;
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (!selectedPoster) {
			message = m.item_msg_stage_first();
			return;
		}
		busy = true;
		message = null;
		try {
			const res = await fetch(`/api/items/${data.item.id}/apply`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					posterUrl: selectedPoster,
					backgroundUrl: selectedBackground,
					method
				})
			});
			const { outcomes } = await res.json();
			message = outcomes
				.map(
					(o: { method: string; status: string; error?: string }) =>
						`${o.method}: ${o.status}${o.error ? ` (${o.error})` : ''}`
				)
				.join(' · ');
			await invalidateAll();
		} finally {
			busy = false;
		}
	}
</script>

{#snippet posterTile(c: PosterCandidate)}
	<button
		type="button"
		onclick={() => pickPoster(c.url)}
		class="overflow-hidden rounded-lg border-2 transition {selectedPoster === c.url
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		<img src={c.url} alt="poster" loading="lazy" class="aspect-[2/3] w-full object-cover" />
	</button>
{/snippet}

{#snippet backdropTile(c: PosterCandidate)}
	<button
		type="button"
		onclick={() => pickBackground(c.url)}
		class="overflow-hidden rounded-lg border-2 transition {selectedBackground === c.url
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		<img src={c.url} alt="backdrop" loading="lazy" class="aspect-video w-full object-cover" />
	</button>
{/snippet}

<a href="/library" class="text-sm text-neutral-400 hover:text-neutral-200"
	>{m.item_back_to_library()}</a
>

<!-- Hero -->
<section class="relative mt-3 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
	{#if data.item.backdropUrl}
		<img src={data.item.backdropUrl} alt="" class="absolute inset-0 h-full w-full object-cover" />
	{/if}
	<div
		class="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-neutral-950/30"
	></div>
	<div class="absolute inset-0 bg-gradient-to-r from-neutral-950/90 to-transparent"></div>

	<div class="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:p-7">
		<div
			class="w-32 flex-none overflow-hidden rounded-lg border border-neutral-800 shadow-2xl sm:w-40"
		>
			{#if data.item.currentPosterUrl}
				<img src={data.item.currentPosterUrl} alt={data.item.title} class="w-full" />
			{:else}
				<div class="flex aspect-[2/3] items-center justify-center text-neutral-600">
					{m.item_no_poster()}
				</div>
			{/if}
		</div>

		<div class="min-w-0 flex-1">
			{#if data.item.logoUrl}
				<img
					src={data.item.logoUrl}
					alt={data.item.title}
					class="max-h-24 max-w-[60%] object-contain drop-shadow-lg"
				/>
			{:else}
				<h1 class="text-3xl font-bold tracking-tight">{data.item.title}</h1>
			{/if}

			{#if metaBits.length}
				<p class="mt-2 text-sm text-neutral-300">
					{#each metaBits as bit, i (bit)}{#if i > 0}<span class="text-neutral-600">
								·
							</span>{/if}<span class={bit.startsWith('★') ? 'font-semibold text-amber-300' : ''}
							>{bit}</span
						>{/each}
				</p>
			{/if}

			{#if data.item.genres?.length}
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#each data.item.genres as g (g)}<span class="chip">{g}</span>{/each}
				</div>
			{/if}

			{#if data.item.tagline}
				<p class="mt-3 text-sm text-neutral-400 italic">“{data.item.tagline}”</p>
			{/if}
			{#if data.item.overview}
				<p class="mt-2 line-clamp-3 max-w-2xl text-sm text-neutral-300">{data.item.overview}</p>
			{/if}

			<div class="mt-4 flex flex-wrap items-center gap-2">
				<button onclick={discover} disabled={busy || !data.item.resolved} class="btn btn-subtle">
					{busy ? m.item_working() : m.item_find_covers()}
				</button>
				{#if data.history.length}
					<button onclick={revert} disabled={busy} class="btn btn-ghost">{m.item_revert()}</button>
				{/if}
			</div>

			{#if !enriched}
				<p class="mt-3 text-xs text-neutral-500">
					{m.item_no_metadata()}
				</p>
			{/if}
		</div>
	</div>
</section>

{#if data.item.cast?.length}
	<section class="mt-6">
		<h2 class="section-title">{m.item_cast()}</h2>
		<div class="flex gap-4 overflow-x-auto pb-2">
			{#each data.item.cast as person (person.name)}
				<div class="w-20 flex-none text-center">
					<div
						class="aspect-[2/3] w-20 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
					>
						{#if person.profileUrl}
							<img
								src={person.profileUrl}
								alt={person.name}
								loading="lazy"
								class="h-full w-full object-cover"
							/>
						{/if}
					</div>
					<p class="mt-1 truncate text-xs font-medium text-neutral-200" title={person.name}>
						{person.name}
					</p>
					{#if person.character}<p
							class="truncate text-[10px] text-neutral-500"
							title={person.character}
						>
							{person.character}
						</p>{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

<!-- Artwork sets, grouped by provider -->
{#if data.providerGroups.length}
	<section class="mt-8 space-y-6 pb-32">
		{#each data.providerGroups as group (group.provider)}
			<h2 class="section-title">
				{group.sets.length === 1
					? m.item_set_count_one({
							provider: providerLabel(group.provider),
							count: group.sets.length
						})
					: m.item_set_count({ provider: providerLabel(group.provider), count: group.sets.length })}
			</h2>
			{#each group.sets as set (set.setId)}
				{@const posters = setKinds(set, 'poster')}
				{@const backdrops = setKinds(set, 'background')}
				{@const seasons = setKinds(set, 'season')}
				{@const cards = setKinds(set, 'title_card')}
				<div class="surface p-4">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-sm text-neutral-300">
							{#if set.author}{m.item_set_by()}
								<span class="font-semibold text-neutral-100">{set.author}</span>{:else}<span
									class="text-neutral-500">{m.item_set_unattributed()}</span
								>{/if}
						</p>
						{#if posters.length || backdrops.length}
							<button onclick={() => useSet(set)} class="btn btn-accent px-3 py-1 text-xs"
								>{m.item_use_set()}</button
							>
						{/if}
					</div>

					<div class="flex flex-col gap-4 sm:flex-row">
						{#if posters.length}
							<div class="min-w-0 flex-1">
								<p class="mb-1 text-[11px] text-neutral-500">
									{posters.length > 1 ? m.item_posters() : m.item_poster()}
								</p>
								<div class="flex gap-2 overflow-x-auto pb-2">
									{#each posters as c (c.id)}<div class="w-20 flex-none">
											{@render posterTile(c)}
										</div>{/each}
								</div>
							</div>
						{/if}
						{#if backdrops.length}
							<div class="min-w-0 flex-1">
								<p class="mb-1 text-[11px] text-neutral-500">
									{backdrops.length > 1 ? m.item_backdrops() : m.item_backdrop()}
								</p>
								<div class="grid grid-cols-2 gap-2">
									{#each backdrops as c (c.id)}{@render backdropTile(c)}{/each}
								</div>
							</div>
						{/if}
					</div>

					{#if isShow && seasons.length}
						<div class="mt-4">
							<p class="mb-1 text-[11px] text-neutral-500">
								{m.item_season_posters({ count: seasons.length })}
							</p>
							<div class="grid grid-cols-4 gap-2 sm:grid-cols-8">
								{#each seasons as c (c.id)}{@render posterTile(c)}{/each}
							</div>
						</div>
					{/if}
					{#if isShow && cards.length}
						<div class="mt-4">
							<p class="mb-1 text-[11px] text-neutral-500">
								{m.item_title_cards({ count: cards.length })}
							</p>
							<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
								{#each cards as c (c.id)}{@render backdropTile(c)}{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		{/each}
	</section>
{:else}
	<p class="mt-8 pb-32 text-sm text-neutral-500">
		{data.item.resolved ? m.item_no_candidates_resolved() : m.item_no_candidates_unresolved()}
	</p>
{/if}

<!-- Sticky custom-set builder -->
<div
	class="fixed inset-x-0 bottom-0 z-30 border-t border-accent-900/40 bg-neutral-950/95 backdrop-blur"
>
	<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
		<div class="flex items-center gap-2">
			<div
				class="h-[51px] w-[34px] flex-none overflow-hidden rounded border border-neutral-700 bg-neutral-900"
			>
				{#if selectedPoster}<img
						src={selectedPoster}
						alt=""
						class="h-full w-full object-cover"
					/>{/if}
			</div>
			<div
				class="h-[45px] w-20 flex-none overflow-hidden rounded border border-neutral-700 bg-neutral-900"
			>
				{#if selectedBackground}<img
						src={selectedBackground}
						alt=""
						class="h-full w-full object-cover"
					/>{/if}
			</div>
		</div>
		<span class="text-xs text-neutral-400">
			{selectedPoster ? m.item_label_poster() : m.item_label_no_poster()}{selectedBackground
				? m.item_label_backdrop_suffix()
				: ''}
		</span>

		<details class="text-xs">
			<summary class="cursor-pointer text-neutral-400 hover:text-neutral-200"
				>{m.item_custom()}</summary
			>
			<div
				class="absolute bottom-14 left-4 flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3 shadow-xl"
			>
				<div class="flex gap-1.5">
					<input
						bind:value={posterUrlInput}
						placeholder={m.item_poster_url_placeholder()}
						class="input w-56 py-1 text-xs"
					/>
					<button onclick={() => useCustomUrl('poster')} class="btn btn-subtle px-2 py-1 text-xs"
						>{m.item_set()}</button
					>
				</div>
				<div class="flex gap-1.5">
					<input
						bind:value={backgroundUrlInput}
						placeholder={m.item_backdrop_url_placeholder()}
						class="input w-56 py-1 text-xs"
					/>
					<button
						onclick={() => useCustomUrl('background')}
						class="btn btn-subtle px-2 py-1 text-xs">{m.item_set()}</button
					>
				</div>
				<div class="flex items-center gap-1.5">
					<input
						type="file"
						accept="image/*"
						onchange={(e) => (posterFile = e.currentTarget.files?.[0] ?? null)}
						class="max-w-[180px] text-[11px] text-neutral-400"
					/>
					<button
						onclick={uploadPoster}
						disabled={busy || !posterFile}
						class="btn btn-subtle px-2 py-1 text-xs">{m.item_upload_poster()}</button
					>
				</div>
				<p class="text-[10px] text-neutral-500">
					{m.item_upload_hint()}
				</p>
			</div>
		</details>

		<div class="ml-auto flex items-center gap-2">
			{#if message}<span class="hidden max-w-xs truncate text-xs text-neutral-400 sm:inline"
					>{message}</span
				>{/if}
			<select bind:value={method} class="input py-1 text-xs">
				<option value="both">{m.library_method_both()}</option>
				<option value="plex">{m.library_method_plex()}</option>
				<option value="kometa">{m.library_method_kometa()}</option>
			</select>
			<button onclick={apply} disabled={busy || !selectedPoster} class="btn btn-accent"
				>{m.item_apply()}</button
			>
		</div>
	</div>
</div>

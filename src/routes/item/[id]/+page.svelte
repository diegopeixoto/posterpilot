<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PosterCandidate } from '$lib/server/db/schema';
	import type { CandidateSet } from '$lib/server/posters/sets';
	import { groupSetArtwork } from '$lib/posters/season-groups';
	import { defaultExpanded, providerKey, setKey, seasonKey } from '$lib/posters/collapse';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	let selectedPoster = $state<string | null>(data.item.selectedPosterUrl);
	let selectedBackground = $state<string | null>(data.item.selectedBackgroundUrl);
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let busy = $state(false);
	let message = $state<string | null>(null);
	// Whether the current message is an error (drives role="alert" + red styling).
	let messageError = $state(false);
	function setMessage(text: string, isError = false) {
		message = text;
		messageError = isError;
	}

	// Confirm gate for applying artwork to the live server (plex/both write to the
	// real media server and are hard to undo; kometa-only writes a re-runnable file).
	let confirmApply = $state(false);
	const needsConfirm = $derived(method === 'plex' || method === 'both');
	const confirmTarget = $derived(
		method === 'both' ? `${m.apply_target_server()} + Kometa` : m.apply_target_server()
	);

	let posterUrlInput = $state('');
	let backgroundUrlInput = $state('');
	let posterFile = $state<File | null>(null);

	const isShow = $derived(data.item.type === 'show');

	// ---- Season/episode (child) selection state -------------------------------
	// Keyed `kind:season:episode` (episode empty for season-level slots).
	function childKey(kind: string, season: number, episode: number | null): string {
		return `${kind}:${season}:${episode ?? ''}`;
	}
	function hydrateChildren(rows: typeof data.childSelections): Record<string, string> {
		const out: Record<string, string> = {};
		for (const r of rows) out[childKey(r.kind, r.season, r.episode)] = r.url;
		return out;
	}
	let childSel = $state<Record<string, string>>(hydrateChildren(data.childSelections));
	function isChildStaged(kind: string, season: number, episode: number | null, url: string) {
		return childSel[childKey(kind, season, episode)] === url;
	}
	const stagedSeasons = $derived(
		Object.keys(childSel).filter((k) => k.startsWith('poster:') || k.startsWith('background:'))
			.length
	);
	const stagedEpisodes = $derived(
		Object.keys(childSel).filter((k) => k.startsWith('title_card:')).length
	);
	const hasStaged = $derived(
		Boolean(selectedPoster) ||
			Boolean(selectedBackground) ||
			stagedSeasons > 0 ||
			stagedEpisodes > 0
	);

	// ---- Collapse state (provider / set / season) -----------------------------
	const COLLAPSE_NS = 'pp:collapse:';
	let expanded = $state<Set<string>>(defaultExpanded(data.providerGroups));
	function isExpanded(key: string) {
		return expanded.has(key);
	}
	function toggle(key: string) {
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expanded = next;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(COLLAPSE_NS + data.item.id, JSON.stringify([...next]));
		}
	}
	// Load persisted collapse state on mount and whenever the item changes; falls
	// back to the default (first provider + first set expanded). Kept out of the
	// initial $state so SSR and first client render agree (no hydration mismatch).
	$effect(() => {
		const id = data.item.id;
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(COLLAPSE_NS + id);
			expanded = raw ? new Set(JSON.parse(raw) as string[]) : defaultExpanded(data.providerGroups);
		} catch {
			expanded = defaultExpanded(data.providerGroups);
		}
	});

	// Re-sync local selection when navigating to a different item.
	let loadedId = data.item.id;
	$effect(() => {
		if (data.item.id !== loadedId) {
			loadedId = data.item.id;
			selectedPoster = data.item.selectedPosterUrl;
			selectedBackground = data.item.selectedBackgroundUrl;
			childSel = hydrateChildren(data.childSelections);
			message = null;
			messageError = false;
			confirmApply = false;
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

	const PROVIDER_LABELS: Record<string, string> = {
		mediux: 'MediUX',
		tmdb: 'TMDB',
		fanarttv: 'Fanart.tv',
		theposterdb: 'ThePosterDB'
	};
	function providerLabel(id: string): string {
		return PROVIDER_LABELS[id] ?? id;
	}

	const jsonHeaders = { 'content-type': 'application/json' };

	/** Persist the current staged poster + background as the pending selection. */
	async function persistSelection() {
		await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: jsonHeaders,
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

	/** Toggle a single season/episode slot and persist it. */
	async function pickChild(kind: string, season: number, episode: number | null, url: string) {
		const key = childKey(kind, season, episode);
		const next = childSel[key] === url ? null : url;
		if (next === null) {
			const copy = { ...childSel };
			delete copy[key];
			childSel = copy;
		} else {
			childSel = { ...childSel, [key]: url };
		}
		await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify({ child: { kind, season, episode }, url: next })
		});
	}

	/** Stage a whole set: show poster + backdrop and every season/episode slot it covers. */
	async function useSet(set: CandidateSet) {
		const g = groupSetArtwork(set.candidates);
		if (g.posters[0]) selectedPoster = g.posters[0].url;
		if (g.backgrounds[0]) selectedBackground = g.backgrounds[0].url;
		await persistSelection();

		const children: { kind: string; season: number; episode: number | null; url: string }[] = [];
		const seenEpisode = new Set<string>();
		for (const sg of g.seasons) {
			if (sg.posters[0]) {
				children.push({ kind: 'poster', season: sg.season, episode: null, url: sg.posters[0].url });
			}
			for (const tc of sg.titleCards) {
				if (tc.episode === null) continue;
				const epKey = `${sg.season}:${tc.episode}`;
				if (seenEpisode.has(epKey)) continue;
				seenEpisode.add(epKey);
				children.push({ kind: 'title_card', season: sg.season, episode: tc.episode, url: tc.url });
			}
		}
		if (children.length) {
			await fetch(`/api/items/${data.item.id}/select`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({ children })
			});
			const add: Record<string, string> = {};
			for (const c of children) add[childKey(c.kind, c.season, c.episode)] = c.url;
			childSel = { ...childSel, ...add };
		}
		setMessage(m.item_msg_set_staged());
	}

	async function useCustomUrl(which: 'poster' | 'background') {
		const url = (which === 'poster' ? posterUrlInput : backgroundUrlInput).trim();
		if (!url) return;
		if (which === 'poster') selectedPoster = url;
		else selectedBackground = url;
		await persistSelection();
	}

	async function discover() {
		if (busy) return;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/discover`, { method: 'POST' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok || result.error) {
				setMessage(m.item_msg_discovery_failed({ error: result.error ?? res.status }), true);
			} else {
				setMessage(
					result.count === 1
						? m.item_msg_found_cover_one({ count: result.count })
						: m.item_msg_found_covers({ count: result.count })
				);
			}
			await invalidateAll();
		} catch {
			setMessage(m.item_msg_discovery_failed({ error: m.item_error_network() }), true);
		} finally {
			busy = false;
		}
	}

	async function uploadPoster() {
		if (!posterFile || busy) return;
		busy = true;
		setMessage('');
		try {
			const fd = new FormData();
			fd.append('file', posterFile);
			const res = await fetch(`/api/items/${data.item.id}/upload`, { method: 'POST', body: fd });
			const result = await res.json().catch(() => ({}));
			if (res.ok && result.ok) setMessage(m.item_msg_uploaded());
			else setMessage(m.item_msg_upload_failed({ error: result.error ?? res.status }), true);
			await invalidateAll();
		} catch {
			setMessage(m.item_msg_upload_failed({ error: m.item_error_network() }), true);
		} finally {
			busy = false;
		}
	}

	async function revert() {
		if (busy) return;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/revert`, { method: 'POST' });
			const result = await res.json().catch(() => ({}));
			if (res.ok && result.ok) {
				setMessage(m.item_msg_reverted());
				selectedPoster = null;
				selectedBackground = null;
				childSel = {};
			} else {
				setMessage(m.item_msg_revert_failed({ error: result.error ?? res.status }), true);
			}
			await invalidateAll();
		} catch {
			setMessage(m.item_msg_revert_failed({ error: m.item_error_network() }), true);
		} finally {
			busy = false;
		}
	}

	/** Revert a single season (its poster + its episodes' title cards). */
	async function revertSeason(season: number) {
		if (busy) return;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/revert`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({ season })
			});
			const result = await res.json().catch(() => ({}));
			if (res.ok && result.ok) {
				setMessage(m.item_msg_reverted());
				const copy = { ...childSel };
				for (const k of Object.keys(copy)) {
					if (Number(k.split(':')[1]) === season) delete copy[k];
				}
				childSel = copy;
			} else {
				setMessage(m.item_msg_revert_failed({ error: result.error ?? res.status }), true);
			}
			await invalidateAll();
		} catch {
			setMessage(m.item_msg_revert_failed({ error: m.item_error_network() }), true);
		} finally {
			busy = false;
		}
	}

	/** Apply button: validate, then gate live-server writes behind a confirm. */
	function requestApply() {
		if (!hasStaged) {
			setMessage(m.item_msg_stage_first(), true);
			return;
		}
		if (needsConfirm) {
			confirmApply = true;
			return;
		}
		apply();
	}

	async function apply() {
		if (busy || !hasStaged) return;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/apply`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({
					posterUrl: selectedPoster,
					backgroundUrl: selectedBackground,
					method
				})
			});
			const { outcomes } = (await res.json().catch(() => ({ outcomes: [] }))) as {
				outcomes: {
					method: string;
					status: string;
					error?: string;
					children?: { applied: number; failed: number; skipped: number };
				}[];
			};
			const targetLabel = (mth: string) => (mth === 'kometa' ? 'Kometa' : m.apply_target_server());
			const failed = outcomes.filter((o) => o.status === 'failed');
			const skipped = outcomes.reduce((n, o) => n + (o.children?.skipped ?? 0), 0);
			// Per-child upload failures keep method status 'success' (the show-level write
			// succeeded), so surface them here rather than reporting a clean success.
			const childFailed = outcomes.reduce((n, o) => n + (o.children?.failed ?? 0), 0);
			if (!res.ok && !outcomes.length) {
				setMessage(m.item_msg_apply_failed({ target: confirmTarget, error: res.status }), true);
			} else if (failed.length === 0) {
				if (childFailed > 0) {
					setMessage(m.item_msg_applied_partial({ count: childFailed }), true);
				} else {
					setMessage(
						skipped ? m.item_msg_applied_skipped({ count: skipped }) : m.item_msg_applied()
					);
				}
				confirmApply = false;
			} else {
				setMessage(
					failed
						.map((o) =>
							m.item_msg_apply_failed({ target: targetLabel(o.method), error: o.error ?? '' })
						)
						.join(' · '),
					true
				);
			}
			await invalidateAll();
		} catch {
			setMessage(
				m.item_msg_apply_failed({ target: confirmTarget, error: m.item_error_network() }),
				true
			);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{data.item.title} · PosterPilot</title></svelte:head>

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

{#snippet seasonPosterTile(c: PosterCandidate, season: number)}
	<button
		type="button"
		onclick={() => pickChild('poster', season, null, c.url)}
		class="overflow-hidden rounded-lg border-2 transition {isChildStaged(
			'poster',
			season,
			null,
			c.url
		)
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		<img src={c.url} alt="season poster" loading="lazy" class="aspect-[2/3] w-full object-cover" />
	</button>
{/snippet}

{#snippet titleCardTile(c: PosterCandidate, season: number)}
	<button
		type="button"
		onclick={() => pickChild('title_card', season, c.episode, c.url)}
		class="overflow-hidden rounded-lg border-2 transition {isChildStaged(
			'title_card',
			season,
			c.episode,
			c.url
		)
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		<img src={c.url} alt="title card" loading="lazy" class="aspect-video w-full object-cover" />
	</button>
{/snippet}

{#snippet chevron(open: boolean)}
	<span
		class="inline-block text-neutral-500 transition-transform motion-reduce:transition-none {open
			? 'rotate-90'
			: ''}"
		aria-hidden="true">▸</span
	>
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
				<div class="flex aspect-[2/3] items-center justify-center text-neutral-400">
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
					{#each metaBits as bit, i (bit)}{#if i > 0}<span class="text-neutral-400">
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
				<p class="mt-3 text-xs text-neutral-400">
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
							class="truncate text-[10px] text-neutral-400"
							title={person.character}
						>
							{person.character}
						</p>{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

<!-- Artwork sets, grouped by provider (collapsible) -->
{#if data.providerGroups.length}
	<section class="mt-8 space-y-6 pb-32">
		{#each data.providerGroups as group (group.provider)}
			{@const pKey = providerKey(group.provider)}
			<div>
				<button
					type="button"
					onclick={() => toggle(pKey)}
					aria-expanded={isExpanded(pKey)}
					aria-label={isExpanded(pKey) ? m.item_collapse() : m.item_expand()}
					class="section-title flex w-full items-center gap-2"
				>
					{@render chevron(isExpanded(pKey))}
					<span>
						{group.sets.length === 1
							? m.item_set_count_one({
									provider: providerLabel(group.provider),
									count: group.sets.length
								})
							: m.item_set_count({
									provider: providerLabel(group.provider),
									count: group.sets.length
								})}
					</span>
				</button>

				{#if isExpanded(pKey)}
					<div class="mt-2 space-y-4">
						{#each group.sets as set (set.setId)}
							{@const sKey = setKey(set.setId)}
							{@const g = groupSetArtwork(set.candidates)}
							<div class="surface p-4">
								<div class="flex items-center justify-between">
									<button
										type="button"
										onclick={() => toggle(sKey)}
										aria-expanded={isExpanded(sKey)}
										class="flex items-center gap-2 text-sm text-neutral-300"
									>
										{@render chevron(isExpanded(sKey))}
										{#if set.author}{m.item_set_by()}
											<span class="font-semibold text-neutral-100">{set.author}</span>{:else}<span
												class="text-neutral-400">{m.item_set_unattributed()}</span
											>{/if}
									</button>
									{#if g.posters.length || g.backgrounds.length || g.seasons.length}
										<button onclick={() => useSet(set)} class="btn btn-accent px-3 py-1 text-xs"
											>{m.item_use_set()}</button
										>
									{/if}
								</div>

								{#if isExpanded(sKey)}
									<div class="mt-3 flex flex-col gap-4 sm:flex-row">
										{#if g.posters.length}
											<div class="min-w-0 flex-1">
												<p class="mb-1 text-[11px] text-neutral-400">
													{g.posters.length > 1 ? m.item_posters() : m.item_poster()}
												</p>
												<div class="flex gap-2 overflow-x-auto pb-2">
													{#each g.posters as c (c.id)}<div class="w-20 flex-none">
															{@render posterTile(c)}
														</div>{/each}
												</div>
											</div>
										{/if}
										{#if g.backgrounds.length}
											<div class="min-w-0 flex-1">
												<p class="mb-1 text-[11px] text-neutral-400">
													{g.backgrounds.length > 1 ? m.item_backdrops() : m.item_backdrop()}
												</p>
												<div class="grid grid-cols-2 gap-2">
													{#each g.backgrounds as c (c.id)}{@render backdropTile(c)}{/each}
												</div>
											</div>
										{/if}
									</div>

									{#if isShow}
										{#each g.seasons as sg (sg.season)}
											{@const seaKey = seasonKey(set.setId, sg.season)}
											<div class="mt-4 rounded-lg border border-neutral-800 p-3">
												<div class="flex items-center justify-between">
													<button
														type="button"
														onclick={() => toggle(seaKey)}
														aria-expanded={isExpanded(seaKey)}
														class="flex items-center gap-2 text-sm font-medium text-neutral-200"
													>
														{@render chevron(isExpanded(seaKey))}
														{m.item_season_label({ number: sg.season })}
													</button>
													{#if data.history.length}
														<button
															onclick={() => revertSeason(sg.season)}
															disabled={busy}
															class="btn btn-ghost px-2 py-1 text-xs"
															>{m.item_revert_season()}</button
														>
													{/if}
												</div>

												{#if isExpanded(seaKey)}
													{#if sg.posters.length}
														<p class="mt-2 mb-1 text-[11px] text-neutral-400">
															{sg.posters.length > 1 ? m.item_posters() : m.item_poster()}
														</p>
														<div class="grid grid-cols-4 gap-2 sm:grid-cols-8">
															{#each sg.posters as c (c.id)}{@render seasonPosterTile(
																	c,
																	sg.season
																)}{/each}
														</div>
													{/if}
													{#if sg.titleCards.length}
														<p class="mt-3 mb-1 text-[11px] text-neutral-400">
															{m.item_title_cards({ count: sg.titleCards.length })}
														</p>
														<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
															{#each sg.titleCards as c (c.id)}{@render titleCardTile(
																	c,
																	sg.season
																)}{/each}
														</div>
													{/if}
												{/if}
											</div>
										{/each}
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</section>
{:else}
	<p class="mt-8 pb-32 text-sm text-neutral-400">
		{data.item.resolved ? m.item_no_candidates_resolved() : m.item_no_candidates_unresolved()}
	</p>
{/if}

<!-- Sticky custom-set builder -->
<div
	class="fixed inset-x-0 bottom-0 z-30 border-t border-accent-900/40 bg-neutral-950/95 backdrop-blur"
>
	<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
		{#if message}
			<p
				role={messageError ? 'alert' : 'status'}
				aria-live={messageError ? 'assertive' : 'polite'}
				class="basis-full text-xs {messageError ? 'text-red-300' : 'text-neutral-300'}"
			>
				{message}
			</p>
		{/if}
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
				: ''}{#if stagedSeasons}
				· {m.item_staged_seasons({ count: stagedSeasons })}{/if}{#if stagedEpisodes}
				· {m.item_staged_episodes({ count: stagedEpisodes })}{/if}
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
						aria-label={m.item_upload_file_label()}
						onchange={(e) => (posterFile = e.currentTarget.files?.[0] ?? null)}
						class="max-w-[180px] text-[11px] text-neutral-400"
					/>
					<button
						onclick={uploadPoster}
						disabled={busy || !posterFile}
						class="btn btn-subtle px-2 py-1 text-xs">{m.item_upload_poster()}</button
					>
				</div>
				<p class="text-[10px] text-neutral-400">
					{m.item_upload_hint()}
				</p>
			</div>
		</details>

		<div class="ml-auto flex items-center gap-2">
			<select
				bind:value={method}
				onchange={() => (confirmApply = false)}
				aria-label={m.library_apply_method_label()}
				class="input py-1 text-xs"
			>
				<option value="both">{m.library_method_both()}</option>
				<option value="plex">{m.library_method_plex()}</option>
				<option value="kometa">{m.library_method_kometa()}</option>
			</select>
			{#if confirmApply}
				<!-- Confirm before writing to the live server (hard to undo). -->
				<span class="hidden text-xs text-neutral-200 sm:inline"
					>{m.item_apply_confirm({ target: confirmTarget })}</span
				>
				<button onclick={apply} disabled={busy} class="btn btn-accent">
					{busy ? m.item_working() : m.library_apply_confirm_yes()}
				</button>
				<button onclick={() => (confirmApply = false)} disabled={busy} class="btn btn-ghost">
					{m.jobs_cancel()}
				</button>
			{:else}
				<button onclick={requestApply} disabled={busy || !hasStaged} class="btn btn-accent"
					>{busy ? m.item_working() : m.item_apply()}</button
				>
			{/if}
		</div>
	</div>
</div>

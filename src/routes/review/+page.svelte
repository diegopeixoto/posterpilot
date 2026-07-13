<script lang="ts">
	import { goto, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages';
	import ManualTmdbMatch from '$lib/components/ManualTmdbMatch.svelte';

	let { data } = $props();
	// svelte-ignore state_referenced_locally
	let query = $state(data.filter.q ?? '');
	// svelte-ignore state_referenced_locally
	let syncedQuery = $state(data.filter.q ?? '');
	let savingView = $state(false);
	let viewName = $state('');
	let viewError = $state(false);
	const actionBusy = new SvelteSet<number>();
	let liveMessage = $state('');

	const stateOrder = [
		'new',
		'unresolved',
		'no_candidates',
		'suggestion_ready',
		'staged',
		'partial_failure',
		'externally_changed',
		'ignored',
		'completed'
	] as const;

	function stateLabel(state: string): string {
		switch (state) {
			case 'new':
				return m.review_state_new();
			case 'unresolved':
				return m.review_state_unresolved();
			case 'no_candidates':
				return m.review_state_no_candidates();
			case 'suggestion_ready':
				return m.review_state_suggestion_ready();
			case 'staged':
				return m.review_state_staged();
			case 'partial_failure':
				return m.review_state_partial_failure();
			case 'externally_changed':
				return m.review_state_externally_changed();
			case 'ignored':
				return m.review_state_ignored();
			default:
				return m.review_state_completed();
		}
	}

	function stateClass(state: string): string {
		if (state === 'partial_failure') return 'badge badge-error';
		if (state === 'externally_changed' || state === 'unresolved') return 'badge badge-warn';
		if (state === 'completed') return 'badge badge-changed';
		return 'badge badge-info';
	}

	function failedDestinationLabel(destination: string | null): string {
		if (destination === 'server') return m.item_history_server();
		if (destination === 'kometa') return 'Kometa';
		return m.review_unknown_target();
	}

	function failedSlotLabel(kind: string | null): string {
		if (kind === 'poster') return m.item_poster();
		if (kind === 'background') return m.item_backdrop();
		if (kind === 'title_card') return m.item_title_card();
		return m.review_unknown_slot();
	}

	function failedSlotSummary(slot: (typeof data.items)[number]['failedSlots'][number]): string {
		const destination = failedDestinationLabel(slot.destination);
		const kind = failedSlotLabel(slot.kind);
		if (slot.season == null) return m.review_failed_slot_root({ destination, kind });
		if (slot.episode == null) {
			return m.review_failed_slot_season({ destination, kind, season: slot.season });
		}
		return m.review_failed_slot_episode({
			destination,
			kind,
			season: slot.season,
			episode: slot.episode
		});
	}

	function urlWith(key: string, value: string | undefined) {
		const url = new URL(page.url);
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		if (key === 'state') url.searchParams.delete('attention');
		if (key !== 'offset') url.searchParams.delete('offset');
		if (key !== 'view') url.searchParams.delete('view');
		return `${url.pathname}${url.search}`;
	}

	async function setFilter(key: string, value: string | undefined = undefined) {
		await goto(urlWith(key, value), { keepFocus: true });
	}

	async function changeServer(id: string) {
		const params = new URLSearchParams({ server: id });
		await goto(`/review?${params}`);
	}

	async function openView(id: string) {
		if (!id) {
			await goto(`/review?server=${encodeURIComponent(data.filter.serverInstanceId)}`);
			return;
		}
		await goto(
			`/review?server=${encodeURIComponent(data.filter.serverInstanceId)}&view=${encodeURIComponent(id)}`
		);
	}

	function savedDefinition() {
		return {
			serverId: data.filter.serverInstanceId,
			name: viewName,
			librarySectionKey: data.filter.librarySectionKey ?? null,
			filters: {
				state: data.filter.state,
				type: data.filter.type,
				availability: data.filter.availability,
				q: data.filter.q,
				changedSince: data.filter.changedSince
					? new Date(data.filter.changedSince).toISOString()
					: undefined
			},
			sort: { by: data.filter.sort }
		};
	}

	async function createView() {
		if (!viewName.trim()) return;
		viewError = false;
		const response = await fetch('/api/review/views', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(savedDefinition())
		});
		if (!response.ok) {
			viewError = true;
			return;
		}
		const body = (await response.json()) as { view: { id: string } };
		savingView = false;
		viewName = '';
		await invalidateAll();
		await openView(body.view.id);
	}

	async function updateView() {
		if (!data.activeView) return;
		viewError = false;
		const definition = savedDefinition();
		definition.name = data.activeView.name;
		const response = await fetch(`/api/review/views/${encodeURIComponent(data.activeView.id)}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(definition)
		});
		if (!response.ok) viewError = true;
		else {
			liveMessage = m.review_view_updated();
			await invalidateAll();
		}
	}

	async function deleteView() {
		if (!data.activeView) return;
		const response = await fetch(
			`/api/review/views/${encodeURIComponent(data.activeView.id)}?serverId=${encodeURIComponent(data.filter.serverInstanceId)}`,
			{ method: 'DELETE' }
		);
		if (!response.ok) {
			viewError = true;
			return;
		}
		await invalidateAll();
		await openView('');
	}

	async function performAction(itemId: number, action: string) {
		if (actionBusy.has(itemId)) return false;
		actionBusy.add(itemId);
		try {
			const response = await fetch(`/api/review/items/${itemId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ serverId: data.filter.serverInstanceId, action })
			});
			if (!response.ok) throw new Error('review_action_failed');
			liveMessage = m.review_action_done();
			await invalidateAll();
			return true;
		} catch {
			liveMessage = m.review_action_failed();
			return false;
		} finally {
			actionBusy.delete(itemId);
		}
	}

	async function stageSuggestion(entry: (typeof data.items)[number]) {
		const poster = entry.suggestion.poster;
		const background = entry.suggestion.background;
		if (!poster && !background) return;
		actionBusy.add(entry.item.id);
		try {
			const response = await fetch(`/api/items/${entry.item.id}/select`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...(poster ? { posterUrl: poster.url, posterCandidateId: poster.id } : {}),
					...(background
						? { backgroundUrl: background.url, backgroundCandidateId: background.id }
						: {})
				})
			});
			if (!response.ok) throw new Error('stage_failed');
			actionBusy.delete(entry.item.id);
			await performAction(entry.item.id, 'staged');
		} catch {
			liveMessage = m.review_action_failed();
		} finally {
			actionBusy.delete(entry.item.id);
		}
	}

	function proxied(url: string | null): string | null {
		return url ? `/api/thumb?url=${encodeURIComponent(url)}` : null;
	}

	function itemHref(id: number): string {
		const returnUrl = new URL(page.url);
		returnUrl.searchParams.set('focus', String(id));
		const params = new URLSearchParams({
			returnTo: `${returnUrl.pathname}${returnUrl.search}`
		});
		if (data.reviewContextId) params.set('reviewContext', data.reviewContextId);
		return `/item/${id}?${params.toString()}`;
	}

	$effect(() => {
		const next = data.filter.q ?? '';
		if (next === syncedQuery) return;
		syncedQuery = next;
		query = next;
	});

	// Returning from item detail restores both the server-side page offset and the
	// exact card that opened it. The card is focusable only for this restoration.
	// The `focus` param is consumed on first use (removed via replaceState) so the
	// invalidateAll() every action triggers doesn't yank focus back to this card.
	$effect(() => {
		const focusedId = Number(page.url.searchParams.get('focus'));
		void data.items;
		if (!Number.isSafeInteger(focusedId) || focusedId <= 0) return;
		requestAnimationFrame(() => {
			const url = new URL(window.location.href);
			url.searchParams.delete('focus');
			replaceState(url, page.state);
			const card = document.getElementById(`review-item-${focusedId}`);
			if (!card) return;
			card.focus({ preventScroll: true });
			card.scrollIntoView({ block: 'center', behavior: 'auto' });
		});
	});
</script>

<svelte:head><title>{m.review_title()} · PosterPilot</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">{m.review_title()}</h1>
		<p class="mt-1 text-sm text-neutral-400">
			{m.review_summary({ count: data.total })}
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<select
			aria-label={m.review_saved_views()}
			class="input"
			value={data.activeView?.id ?? ''}
			onchange={(event) => openView(event.currentTarget.value)}
		>
			<option value="">{m.review_view_custom()}</option>
			{#each data.views as view (view.id)}
				<option value={view.id}>{view.name}</option>
			{/each}
		</select>
		{#if data.activeView}
			<button class="btn btn-ghost" type="button" onclick={updateView}
				>{m.review_view_update()}</button
			>
			<button class="btn btn-ghost" type="button" onclick={deleteView}
				>{m.review_view_delete()}</button
			>
		{:else}
			<button
				class="btn btn-ghost"
				type="button"
				aria-expanded={savingView}
				aria-controls="review-save-view"
				onclick={() => (savingView = !savingView)}
			>
				{m.review_view_save()}
			</button>
		{/if}
	</div>
</div>

<p class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</p>

{#if savingView}
	<div id="review-save-view" class="surface mt-4 flex flex-wrap items-end gap-2 p-3">
		<label class="min-w-56 flex-1 text-xs text-neutral-400">
			{m.review_view_name()}
			<input class="input mt-1 w-full" maxlength="60" bind:value={viewName} />
		</label>
		<button class="btn btn-accent" type="button" disabled={!viewName.trim()} onclick={createView}>
			{m.review_view_save_action()}
		</button>
		<button class="btn btn-ghost" type="button" onclick={() => (savingView = false)}>
			{m.review_cancel()}
		</button>
	</div>
{/if}
{#if viewError}<p class="mt-3 text-sm text-red-300" role="alert">{m.review_view_error()}</p>{/if}

<section class="surface mt-5 space-y-4 p-4" aria-label={m.review_filters()}>
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class="chip {data.filter.state || data.filter.attention ? '' : 'chip-active'}"
			aria-pressed={!data.filter.state && !data.filter.attention}
			onclick={() => setFilter('state')}
		>
			{m.review_state_all()} · {Object.values(data.counts).reduce((sum, count) => sum + count, 0)}
		</button>
		{#if data.filter.attention}
			<button
				type="button"
				class="chip chip-active"
				aria-pressed="true"
				onclick={() => setFilter('attention')}
			>
				{m.review_attention()} · {data.total}
			</button>
		{/if}
		{#each stateOrder as state (state)}
			<button
				type="button"
				class="chip {data.filter.state === state ? 'chip-active' : ''}"
				aria-pressed={data.filter.state === state}
				onclick={() => setFilter('state', state)}
			>
				{stateLabel(state)} · {data.counts[state]}
			</button>
		{/each}
	</div>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
		<label class="text-xs text-neutral-400">
			{m.review_server()}
			<select
				class="input mt-1 w-full"
				value={data.filter.serverInstanceId}
				onchange={(event) => changeServer(event.currentTarget.value)}
			>
				{#each data.scopes.servers as server (server.id)}
					<option value={server.id}>{server.name}</option>
				{/each}
			</select>
		</label>
		<label class="text-xs text-neutral-400">
			{m.review_library()}
			<select
				class="input mt-1 w-full"
				value={data.filter.librarySectionKey ?? ''}
				onchange={(event) => setFilter('library', event.currentTarget.value)}
			>
				<option value="">{m.review_all_libraries()}</option>
				{#each data.scopes.libraries.filter((library) => library.serverInstanceId === data.filter.serverInstanceId) as library (`${library.sectionKey}:${library.type}`)}
					<option value={library.sectionKey}
						>{library.sectionKey} · {library.type === 'movie'
							? m.manual_match_type_movie()
							: m.manual_match_type_show()}</option
					>
				{/each}
			</select>
		</label>
		<label class="text-xs text-neutral-400">
			{m.review_media_type()}
			<select
				class="input mt-1 w-full"
				value={data.filter.type ?? ''}
				onchange={(event) => setFilter('type', event.currentTarget.value)}
			>
				<option value="">{m.review_type_all()}</option>
				<option value="movie">{m.manual_match_type_movie()}</option>
				<option value="show">{m.manual_match_type_show()}</option>
			</select>
		</label>
		<label class="text-xs text-neutral-400">
			{m.review_availability()}
			<select
				class="input mt-1 w-full"
				value={data.filter.availability ?? ''}
				onchange={(event) => setFilter('availability', event.currentTarget.value)}
			>
				<option value="">{m.review_availability_all()}</option>
				<option value="candidates">{m.review_availability_candidates()}</option>
				<option value="mediux">{m.review_availability_mediux()}</option>
				<option value="none">{m.review_availability_none()}</option>
			</select>
		</label>
		<label class="text-xs text-neutral-400">
			{m.review_sort()}
			<select
				class="input mt-1 w-full"
				value={data.filter.sort}
				onchange={(event) => setFilter('sort', event.currentTarget.value)}
			>
				<option value="priority">{m.review_sort_priority()}</option>
				<option value="updated">{m.review_sort_updated()}</option>
				<option value="title">{m.review_sort_title()}</option>
				<option value="year">{m.review_sort_year()}</option>
			</select>
		</label>
		<form
			class="text-xs text-neutral-400"
			onsubmit={(event) => {
				event.preventDefault();
				void setFilter('q', query.trim());
			}}
		>
			<label for="review-search">{m.review_search()}</label>
			<div class="mt-1 flex gap-1">
				<input id="review-search" class="input min-w-0 flex-1" bind:value={query} />
				<button class="btn btn-subtle" type="submit">{m.review_search_action()}</button>
			</div>
		</form>
	</div>
</section>

{#if data.items.length === 0}
	<div class="surface mt-5 p-8 text-center">
		<p class="text-sm text-neutral-300">{m.review_empty()}</p>
		<p class="mt-1 text-xs text-neutral-500">{m.review_empty_hint()}</p>
	</div>
{:else}
	<div class="mt-5 space-y-4">
		{#each data.items as entry (entry.item.id)}
			<article
				id={`review-item-${entry.item.id}`}
				tabindex="-1"
				aria-labelledby={`review-item-title-${entry.item.id}`}
				aria-busy={actionBusy.has(entry.item.id)}
				class="surface overflow-hidden p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
			>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<h2 id={`review-item-title-${entry.item.id}`} class="text-lg font-semibold">
								{entry.item.title}
							</h2>
							<span class={stateClass(entry.item.state)}>{stateLabel(entry.item.state)}</span>
						</div>
						<p class="mt-1 text-xs text-neutral-400">
							{entry.item.year ?? m.manual_match_year_unknown()} · {entry.item.type === 'movie'
								? m.manual_match_type_movie()
								: m.manual_match_type_show()} · {entry.item.sectionKey}
						</p>
					</div>
					<a class="btn btn-ghost" href={itemHref(entry.item.id)}>{m.review_open_item()}</a>
				</div>

				<div class="mt-4 grid gap-4 xl:grid-cols-2">
					<div>
						<h3 class="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
							{m.review_compare_poster()}
						</h3>
						<div class="grid grid-cols-3 gap-2">
							<div>
								<p class="mb-1 text-[10px] text-neutral-500">{m.review_current()}</p>
								<div class="overflow-hidden rounded border border-neutral-800 bg-neutral-950">
									{#if entry.item.hasCurrentPoster}
										<img
											src={`/api/artwork/${entry.item.id}/poster?v=${entry.item.currentPosterFingerprint ?? entry.item.artworkVersion}`}
											alt={m.review_current_poster_alt({ title: entry.item.title })}
											class="aspect-[2/3] w-full object-cover"
										/>
									{:else}<div
											class="flex aspect-[2/3] items-center justify-center p-2 text-center text-[10px] text-neutral-500"
										>
											{m.item_no_poster()}
										</div>{/if}
								</div>
							</div>
							<div>
								<p class="mb-1 text-[10px] text-neutral-500">{m.review_suggested()}</p>
								<div class="overflow-hidden rounded border border-accent-900/60 bg-neutral-950">
									{#if entry.suggestion.poster}
										<img
											src={proxied(entry.suggestion.poster.url)}
											alt={m.review_suggested_poster_alt({ title: entry.item.title })}
											class="aspect-[2/3] w-full object-cover"
										/>
									{:else}<div
											class="flex aspect-[2/3] items-center justify-center p-2 text-center text-[10px] text-neutral-500"
										>
											{m.review_none()}
										</div>{/if}
								</div>
								{#if entry.suggestion.poster}<p class="mt-1 truncate text-[10px] text-neutral-500">
										{entry.suggestion.poster.provider}{entry.suggestion.poster.stale
											? ` · ${m.review_stale()}`
											: ''}
									</p>{/if}
							</div>
							<div>
								<p class="mb-1 text-[10px] text-neutral-500">{m.review_staged()}</p>
								<div class="overflow-hidden rounded border border-neutral-700 bg-neutral-950">
									{#if entry.item.selectedPosterUrl}
										<img
											src={proxied(entry.item.selectedPosterUrl)}
											alt={m.review_staged_poster_alt({ title: entry.item.title })}
											class="aspect-[2/3] w-full object-cover"
										/>
									{:else}<div
											class="flex aspect-[2/3] items-center justify-center p-2 text-center text-[10px] text-neutral-500"
										>
											{m.review_none()}
										</div>{/if}
								</div>
							</div>
						</div>
					</div>

					{#if entry.item.hasCurrentBackground || entry.suggestion.background || entry.item.selectedBackgroundUrl}
						<div>
							<h3 class="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
								{m.review_compare_background()}
							</h3>
							<div class="grid grid-cols-3 gap-2">
								{#each [{ label: m.review_current(), url: entry.item.hasCurrentBackground ? `/api/artwork/${entry.item.id}/background?v=${entry.item.currentBackgroundFingerprint ?? entry.item.artworkVersion}` : null }, { label: m.review_suggested(), url: proxied(entry.suggestion.background?.url ?? null) }, { label: m.review_staged(), url: proxied(entry.item.selectedBackgroundUrl) }] as image (image.label)}
									<div>
										<p class="mb-1 text-[10px] text-neutral-500">{image.label}</p>
										<div class="overflow-hidden rounded border border-neutral-800 bg-neutral-950">
											{#if image.url}<img
													src={image.url}
													alt=""
													class="aspect-video w-full object-cover"
												/>{:else}<div
													class="flex aspect-video items-center justify-center text-[10px] text-neutral-500"
												>
													{m.review_none()}
												</div>{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				{#if entry.failedSlots.length}
					<div class="mt-4 rounded-md border border-red-900/50 bg-red-950/20 p-3">
						<p class="text-xs font-semibold text-red-200">{m.review_failed_slots()}</p>
						<ul class="mt-1 text-xs text-red-300">
							{#each entry.failedSlots as slot, index (`${slot.destination}:${slot.kind}:${slot.season}:${slot.episode}:${index}`)}
								<li>
									{failedSlotSummary(slot)}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="mt-4 flex flex-wrap gap-2 border-t border-neutral-800 pt-3">
					{#if entry.suggestion.poster || entry.suggestion.background}
						<button
							type="button"
							class="btn btn-accent"
							disabled={actionBusy.has(entry.item.id)}
							onclick={() => stageSuggestion(entry)}>{m.review_stage_suggestion()}</button
						>
					{/if}
					{#if entry.item.state === 'externally_changed'}
						<button
							type="button"
							class="btn btn-subtle"
							disabled={actionBusy.has(entry.item.id)}
							onclick={() => performAction(entry.item.id, 'accepted_current')}
							>{m.review_accept_current()}</button
						>
					{/if}
					{#if entry.item.state === 'ignored'}
						<button
							type="button"
							class="btn btn-ghost"
							disabled={actionBusy.has(entry.item.id)}
							onclick={() => performAction(entry.item.id, 'unignored')}>{m.review_restore()}</button
						>
					{:else}
						<button
							type="button"
							class="btn btn-ghost"
							disabled={actionBusy.has(entry.item.id)}
							onclick={() => performAction(entry.item.id, 'ignored')}>{m.review_ignore()}</button
						>
					{/if}
					{#if entry.item.state === 'new' || entry.item.state === 'no_candidates'}
						<button
							type="button"
							class="btn btn-ghost"
							disabled={actionBusy.has(entry.item.id)}
							onclick={() => performAction(entry.item.id, 'reviewed')}
							>{m.review_mark_reviewed()}</button
						>
					{/if}
				</div>

				{#if entry.item.state === 'unresolved'}
					<ManualTmdbMatch item={entry.item} locale={data.locale} />
				{/if}
			</article>
		{/each}
	</div>
{/if}

{#if data.total > data.pageSize}
	<nav class="mt-6 flex items-center justify-center gap-3" aria-label={m.review_pagination()}>
		<button
			class="btn btn-ghost"
			disabled={data.filter.offset === 0}
			onclick={() => setFilter('offset', String(Math.max(0, data.filter.offset - data.pageSize)))}
			>{m.review_previous()}</button
		>
		<span class="text-xs text-neutral-400"
			>{m.review_range({
				start: data.filter.offset + 1,
				end: Math.min(data.total, data.filter.offset + data.items.length),
				total: data.total
			})}</span
		>
		<button
			class="btn btn-ghost"
			disabled={data.filter.offset + data.pageSize >= data.total}
			onclick={() => setFilter('offset', String(data.filter.offset + data.pageSize))}
			>{m.review_next()}</button
		>
	</nav>
{/if}

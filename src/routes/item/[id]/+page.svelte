<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let selectedUrl = $state<string | null>(data.item.selectedPosterUrl);
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let busy = $state(false);
	let message = $state<string | null>(null);

	const posters = $derived(data.candidates.filter((c) => c.kind === 'poster'));
	const backgrounds = $derived(data.candidates.filter((c) => c.kind === 'background'));

	// Re-sync the local selection when navigating to a different item.
	let loadedId = data.item.id;
	$effect(() => {
		if (data.item.id !== loadedId) {
			loadedId = data.item.id;
			selectedUrl = data.item.selectedPosterUrl;
		}
	});

	async function discover() {
		busy = true;
		message = null;
		try {
			const res = await fetch(`/api/items/${data.item.id}/discover`, { method: 'POST' });
			const result = await res.json();
			if (!res.ok || result.error) {
				message = `Discovery failed: ${result.error ?? res.status}`;
			} else {
				message = `Found ${result.count} cover${result.count === 1 ? '' : 's'}.`;
			}
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function pick(url: string) {
		selectedUrl = url;
		await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ posterUrl: url })
		});
	}

	async function apply() {
		if (!selectedUrl) return;
		busy = true;
		message = null;
		try {
			const res = await fetch(`/api/items/${data.item.id}/apply`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ posterUrl: selectedUrl, method })
			});
			const { outcomes } = await res.json();
			message = outcomes
				.map((o: { method: string; status: string; error?: string }) =>
					`${o.method}: ${o.status}${o.error ? ` (${o.error})` : ''}`
				)
				.join(' · ');
			await invalidateAll();
		} finally {
			busy = false;
		}
	}
</script>

<a href="/library" class="text-sm text-neutral-400 hover:text-neutral-200">← Library</a>

<div class="mt-3 grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
	<div>
		<div class="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
			{#if data.item.currentPosterUrl}
				<img src={data.item.currentPosterUrl} alt={data.item.title} class="w-full" />
			{:else}
				<div class="flex aspect-[2/3] items-center justify-center text-neutral-600">No poster</div>
			{/if}
		</div>
		<p class="mt-2 text-xs text-neutral-500">Current poster</p>
	</div>

	<div>
		<h1 class="text-2xl font-semibold tracking-tight">{data.item.title}</h1>
		<p class="text-neutral-400">{data.item.year ?? '—'} · {data.item.type}</p>
		<p class="mt-1 text-xs text-neutral-500">
			TMDB: {data.item.tmdbId ?? '—'}
			{#if data.item.mediaType}({data.item.mediaType}){/if}
			· {data.item.resolved ? 'resolved' : 'unresolved'}
		</p>

		<div class="mt-4 flex flex-wrap items-center gap-2">
			<button
				onclick={discover}
				disabled={busy || !data.item.resolved}
				class="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
			>
				{busy ? 'Working…' : 'Find covers'}
			</button>
			<select bind:value={method} class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm">
				<option value="both">Plex + Kometa</option>
				<option value="plex">Plex only</option>
				<option value="kometa">Kometa only</option>
			</select>
			<button
				onclick={apply}
				disabled={busy || !selectedUrl}
				class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
			>
				Apply
			</button>
			{#if message}<span class="text-xs text-neutral-400">{message}</span>{/if}
		</div>
	</div>
</div>

{#if posters.length}
	<h2 class="mt-8 mb-3 text-sm font-semibold text-neutral-400">Poster candidates ({posters.length})</h2>
	<div class="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
		{#each posters as c (c.id)}
			<button
				type="button"
				onclick={() => pick(c.url)}
				class="overflow-hidden rounded-lg border-2 transition {selectedUrl === c.url
					? 'border-indigo-500'
					: 'border-neutral-800 hover:border-neutral-600'}"
			>
				<img src={c.url} alt="candidate" loading="lazy" class="aspect-[2/3] w-full object-cover" />
			</button>
		{/each}
	</div>
{/if}

{#if backgrounds.length}
	<h2 class="mt-8 mb-3 text-sm font-semibold text-neutral-400">Backgrounds ({backgrounds.length})</h2>
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each backgrounds as c (c.id)}
			<img src={c.url} alt="background" loading="lazy" class="aspect-video w-full rounded-lg border border-neutral-800 object-cover" />
		{/each}
	</div>
{/if}

{#if data.candidates.length === 0}
	<p class="mt-8 text-sm text-neutral-500">
		No candidates yet. {data.item.resolved
			? 'Click “Find covers” to search MediaUX.'
			: 'This item has no resolved TMDB id, so MediaUX cannot be searched.'}
	</p>
{/if}

{#if data.history.length}
	<h2 class="mt-8 mb-3 text-sm font-semibold text-neutral-400">History</h2>
	<ul class="space-y-1 text-xs text-neutral-500">
		{#each data.history as h (h.id)}
			<li>{h.method} · {h.status}{h.error ? ` — ${h.error}` : ''}</li>
		{/each}
	</ul>
{/if}

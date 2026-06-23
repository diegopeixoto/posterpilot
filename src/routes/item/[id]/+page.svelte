<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let selectedUrl = $state<string | null>(data.item.selectedPosterUrl);
	let method = $state<'plex' | 'kometa' | 'both'>('both');
	let busy = $state(false);
	let message = $state<string | null>(null);

	let customUrl = $state('');
	let customFile = $state<File | null>(null);

	function useCustomUrl() {
		const url = customUrl.trim();
		if (!url) return;
		selectedUrl = url;
		message = 'Custom URL selected — click Apply above.';
	}

	async function uploadCustomFile() {
		if (!customFile) return;
		busy = true;
		message = null;
		try {
			const fd = new FormData();
			fd.append('file', customFile);
			const res = await fetch(`/api/items/${data.item.id}/upload`, { method: 'POST', body: fd });
			const result = await res.json();
			message = result.ok
				? 'Custom poster uploaded to Plex.'
				: `Upload failed: ${result.error ?? res.status}`;
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

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

	async function revert() {
		busy = true;
		message = null;
		try {
			const res = await fetch(`/api/items/${data.item.id}/revert`, { method: 'POST' });
			const result = await res.json();
			message = result.ok
				? 'Reverted to the original Plex poster.'
				: `Revert failed: ${result.error ?? res.status}`;
			selectedUrl = null;
			await invalidateAll();
		} finally {
			busy = false;
		}
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
			{#if data.history.length}
				<button
					onclick={revert}
					disabled={busy}
					class="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
				>
					Revert to Plex original
				</button>
			{/if}
			{#if message}<span class="text-xs text-neutral-400">{message}</span>{/if}
		</div>
	</div>
</div>

<section class="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
	<h2 class="mb-3 text-sm font-semibold text-neutral-400">Custom cover</h2>
	<div class="flex flex-wrap items-end gap-4">
		<div class="min-w-[260px] flex-1">
			<span class="mb-1 block text-xs text-neutral-500">Image URL — applies to Plex + Kometa</span>
			<div class="flex gap-2">
				<input
					bind:value={customUrl}
					placeholder="https://…/poster.jpg"
					class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
				/>
				<button
					onclick={useCustomUrl}
					disabled={!customUrl.trim()}
					class="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
					>Use URL</button
				>
			</div>
			<p class="mt-1 text-xs text-neutral-600">Selects it — then click Apply above with your method.</p>
		</div>
		<div>
			<span class="mb-1 block text-xs text-neutral-500">Upload file — Plex only</span>
			<div class="flex items-center gap-2">
				<input
					type="file"
					accept="image/*"
					onchange={(e) => (customFile = e.currentTarget.files?.[0] ?? null)}
					class="max-w-[200px] text-xs text-neutral-400"
				/>
				<button
					onclick={uploadCustomFile}
					disabled={busy || !customFile}
					class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
					>Upload to Plex</button
				>
			</div>
		</div>
	</div>
</section>

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

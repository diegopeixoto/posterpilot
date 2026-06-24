<script lang="ts">
	import type { MediaItem } from '$lib/server/db/schema';
	import { m } from '$lib/paraglide/messages';

	let {
		item,
		selectable = false,
		selected = false,
		onToggle
	}: {
		item: MediaItem;
		selectable?: boolean;
		selected?: boolean;
		onToggle?: () => void;
	} = $props();
</script>

<div
	class="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600"
>
	<a href={`/item/${item.id}`} class="block">
		<div class="aspect-[2/3] w-full overflow-hidden bg-neutral-950">
			{#if item.currentPosterUrl}
				<img
					src={item.currentPosterUrl}
					alt={item.title}
					loading="lazy"
					class="h-full w-full object-cover transition group-hover:scale-[1.03]"
				/>
			{:else}
				<div class="flex h-full items-center justify-center text-xs text-neutral-400">
					{m.poster_no_poster()}
				</div>
			{/if}
		</div>

		<!-- Hover title/year overlay -->
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100"
		>
			<p class="truncate text-sm font-medium text-white" title={item.title}>{item.title}</p>
			<p class="text-xs text-neutral-300">{item.year ?? '—'} · {item.type}</p>
		</div>
	</a>

	<!-- Status badge: applied takes priority over "covers available" (mutually exclusive). -->
	<div class="pointer-events-none absolute top-2 left-2 flex gap-1">
		{#if item.selectedPosterUrl}
			<span class="badge badge-changed">✓ {m.poster_badge_changed()}</span>
		{:else if item.hasMediux}
			<span class="badge badge-mediux">{m.poster_badge_covers()}</span>
		{/if}
	</div>

	<!-- Rating -->
	{#if item.rating}
		<span class="badge badge-muted absolute bottom-2 left-2 text-amber-300"
			>★ {item.rating.toFixed(1)}</span
		>
	{/if}

	{#if selectable}
		<button
			type="button"
			onclick={onToggle}
			aria-label={selected ? m.poster_deselect() : m.poster_select()}
			class="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded border text-sm font-bold transition {selected
				? 'border-accent-400 bg-accent-500 text-white'
				: 'border-neutral-600 bg-neutral-900/80 text-transparent opacity-0 group-hover:opacity-100 hover:border-neutral-400'}"
		>
			✓
		</button>
	{/if}
</div>

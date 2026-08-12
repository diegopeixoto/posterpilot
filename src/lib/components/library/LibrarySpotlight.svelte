<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	// The recently-changed item shown above the wall, or null when there's none.
	let {
		spotlight
	}: {
		spotlight: {
			id: number;
			backdropUrl: string | null;
			title: string;
			year: number | null;
		} | null;
	} = $props();
</script>

{#if spotlight?.backdropUrl}
	<a
		href={`/item/${spotlight.id}`}
		class="relative mt-4 block h-40 overflow-hidden rounded-xl border border-border"
	>
		<img src={spotlight.backdropUrl} alt="" class="absolute inset-0 h-full w-full object-cover" />
		<div class="absolute inset-0 bg-gradient-to-r from-background/90 to-transparent"></div>
		<div class="absolute bottom-4 left-5">
			<p class="text-xs tracking-wide text-accent-300 uppercase">{m.library_recently_updated()}</p>
			<p class="text-lg font-semibold text-white">{spotlight.title}</p>
			<p class="text-xs text-text-secondary">{spotlight.year ?? ''}</p>
		</div>
	</a>
{/if}

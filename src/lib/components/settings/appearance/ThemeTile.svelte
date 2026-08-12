<script lang="ts">
	/**
	 * One theme's visual identity in the picker: its three preview swatches and
	 * its name. Kept as its own component because it is the seam where a richer
	 * preview would land — the swatch row is the cheapest possible stand-in for
	 * "what does this theme look like".
	 */
	import type { Theme } from '$lib/theming/schema';

	let {
		swatches,
		name,
		accentOverride = null
	}: {
		swatches: Theme['swatches'] | readonly string[];
		name: string;
		/** A custom theme's own accent, shown in place of its base's third swatch. */
		accentOverride?: string | null;
	} = $props();

	const shown = $derived(
		swatches.map((swatch, index) =>
			accentOverride && index === swatches.length - 1 ? accentOverride : swatch
		)
	);
</script>

<span class="flex gap-1.5" aria-hidden="true">
	{#each shown as swatch, index (index)}
		<span class="size-5 rounded-full border border-black/30" style="background-color: {swatch}"
		></span>
	{/each}
</span>
<span class="text-xs font-medium">{name}</span>

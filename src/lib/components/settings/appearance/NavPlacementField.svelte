<script lang="ts">
	/**
	 * Navigation placement. Native radios inside a `<fieldset>`: the earlier
	 * `<button role="radio">` pairing announced itself as a radiogroup without the
	 * arrow-key movement that pattern requires, and `disabled` on the fieldset is
	 * what makes a theme-forced layout legible instead of a click that resolves
	 * away silently.
	 */
	import { m } from '$lib/paraglide/messages';

	let {
		effective,
		locked,
		lockedByTheme,
		onChange
	}: {
		effective: 'top' | 'left';
		locked: boolean;
		lockedByTheme: string;
		onChange: (placement: 'top' | 'left') => void;
	} = $props();
</script>

<div class="surface flex flex-wrap items-center justify-between gap-3 p-4">
	<div>
		<span class="text-sm font-medium">{m.appearance_nav_placement()}</span>
		{#if locked}
			<p class="mt-0.5 text-xs text-text-faint">
				{m.appearance_nav_locked({ theme: lockedByTheme })}
			</p>
		{/if}
	</div>
	<fieldset class="flex gap-2" disabled={locked}>
		<legend class="sr-only">{m.appearance_nav_placement()}</legend>
		{#each ['top', 'left'] as placement (placement)}
			<label
				class="chip cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-500 has-disabled:cursor-not-allowed has-disabled:opacity-60 {effective ===
				placement
					? 'chip-active'
					: ''}"
			>
				<input
					type="radio"
					name="appearance-nav-placement"
					value={placement}
					checked={effective === placement}
					onchange={() => onChange(placement as 'top' | 'left')}
					class="sr-only"
				/>
				{placement === 'top' ? m.appearance_nav_top() : m.appearance_nav_left()}
			</label>
		{/each}
	</fieldset>
</div>

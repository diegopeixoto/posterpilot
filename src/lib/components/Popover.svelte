<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		label,
		active = false,
		align = 'left',
		trigger,
		children
	}: {
		open?: boolean;
		label: string;
		active?: boolean;
		align?: 'left' | 'right';
		trigger: Snippet;
		children: Snippet;
	} = $props();

	let root = $state<HTMLDivElement | null>(null);

	function toggle() {
		open = !open;
	}

	// Close when clicking outside the popover, or on Escape.
	function onWindowPointerDown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
	function onWindowKeyDown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeyDown} />

<div class="relative" bind:this={root}>
	<button
		type="button"
		onclick={toggle}
		aria-expanded={open}
		aria-haspopup="true"
		class="btn btn-ghost gap-1.5 px-2.5 py-1.5 {active ? 'border-accent-600 text-accent-200' : ''}"
	>
		{@render trigger()}
		<span aria-hidden="true" class="text-[10px] text-neutral-500">▾</span>
	</button>
	{#if open}
		<div
			role="dialog"
			aria-label={label}
			class="surface absolute z-20 mt-2 w-64 bg-neutral-900 p-3 shadow-xl shadow-black/40 {align ===
			'right'
				? 'right-0'
				: 'left-0'}"
		>
			{@render children()}
		</div>
	{/if}
</div>

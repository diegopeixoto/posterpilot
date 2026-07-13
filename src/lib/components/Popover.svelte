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
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLDivElement | null>(null);

	function toggle() {
		open = !open;
	}

	/** Close and return focus to the trigger (keyboard users don't get stranded). */
	function close() {
		open = false;
		triggerEl?.focus();
	}

	// Close when clicking outside the popover, or on Escape.
	function onWindowPointerDown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
	function onWindowKeyDown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') close();
	}

	function focusableElements(): HTMLElement[] {
		if (!panel) return [];
		return Array.from(
			panel.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => element.getClientRects().length > 0);
	}

	function onPanelKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const focusable = focusableElements();
		if (focusable.length === 0) {
			event.preventDefault();
			panel?.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable.at(-1)!;
		const activeElement = document.activeElement;
		if (event.shiftKey && (activeElement === first || activeElement === panel)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	// Move focus into the panel when it opens. Prefer the first interactive control
	// (it shows its own focus ring); fall back to the panel itself — which keeps a
	// visible :focus-visible outline so keyboard users always get a focus cue.
	$effect(() => {
		if (!open) return;
		const first = focusableElements()[0];
		(first ?? panel)?.focus();
	});
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeyDown} />

<div class="relative" bind:this={root}>
	<button
		bind:this={triggerEl}
		type="button"
		onclick={toggle}
		aria-expanded={open}
		aria-haspopup="dialog"
		class="btn btn-ghost gap-1.5 px-2.5 py-1.5 {active ? 'border-accent-600 text-accent-200' : ''}"
	>
		{@render trigger()}
		<span aria-hidden="true" class="text-[10px] text-neutral-400">▾</span>
	</button>
	{#if open}
		<div
			bind:this={panel}
			onkeydown={onPanelKeyDown}
			role="dialog"
			aria-label={label}
			tabindex="-1"
			class="surface absolute z-20 mt-2 w-64 max-w-[calc(100vw-1.5rem)] bg-neutral-900 p-3 shadow-xl shadow-black/40 {align ===
			'right'
				? 'right-0'
				: 'left-0'}"
		>
			{@render children()}
		</div>
	{/if}
</div>

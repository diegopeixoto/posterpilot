<script lang="ts">
	import { toasts } from '$lib/stores/toasts.svelte';
	import { m } from '$lib/paraglide/messages';

	// Success/info are announced politely; errors assertively. Two live regions so
	// the politeness level is correct per severity.
	const regions = $derived([
		{ list: toasts.items.filter((t) => t.type !== 'error'), live: 'polite' as const },
		{ list: toasts.items.filter((t) => t.type === 'error'), live: 'assertive' as const }
	]);

	const styles: Record<string, string> = {
		success: 'border-emerald-800 bg-emerald-950/80 text-emerald-100',
		error: 'border-red-800 bg-red-950/85 text-red-100',
		info: 'border-border-strong bg-surface/90 text-text-bright'
	};
	const icons: Record<string, string> = { success: '✓', error: '⚠', info: 'ℹ' };
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4">
	{#each regions as region (region.live)}
		<div aria-live={region.live} role="status" class="contents">
			{#each region.list as toast (toast.id)}
				<div
					class="toast pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-surface border px-4 py-3 text-sm shadow-2xl {styles[
						toast.type
					]}"
				>
					<span aria-hidden="true" class="mt-px">{icons[toast.type]}</span>
					<span class="flex-1">{toast.message}</span>
					<button
						type="button"
						onclick={() => toasts.dismiss(toast.id)}
						aria-label={m.toast_dismiss()}
						class="opacity-70 transition hover:opacity-100"
					>
						✕
					</button>
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.toast {
		animation: toast-in 160ms ease-out;
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
	}
	/* Motion-safety: no slide/fade for users who prefer reduced motion. */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>

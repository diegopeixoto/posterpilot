<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	interface UndoPreview {
		planId: string;
		digest: string;
		summary: {
			operationCount: number;
			actionableCount: number;
			unavailableCount: number;
			targetCount: number;
			slotCount: number;
			destinations: { server: number; kometa: number };
			restoreStates: { present: number; absent: number; unavailable: number };
		};
	}

	let {
		open,
		busy = false,
		preview,
		contextLabel,
		onConfirm,
		onCancel
	}: {
		open: boolean;
		busy?: boolean;
		preview: UndoPreview | null;
		contextLabel: string;
		onConfirm: () => void | Promise<void>;
		onCancel: () => void;
	} = $props();

	let dialog = $state<HTMLElement | null>(null);
	let cancelButton = $state<HTMLButtonElement | null>(null);
	let lastFocused: HTMLElement | null = null;
	let wasOpen = false;

	function focusable(): HTMLElement[] {
		if (!dialog) return [];
		return [
			...dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		];
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			if (!busy) onCancel();
			return;
		}
		if (event.key !== 'Tab') return;
		const items = focusable();
		if (items.length === 0) {
			event.preventDefault();
			dialog?.focus();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (event.shiftKey && (active === first || active === dialog)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		if (open && !wasOpen) {
			lastFocused = document.activeElement as HTMLElement | null;
			queueMicrotask(() => cancelButton?.focus());
		} else if (!open && wasOpen && lastFocused) {
			lastFocused.focus();
			lastFocused = null;
		}
		wasOpen = open;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && preview}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			aria-label={m.item_undo_cancel()}
			disabled={busy}
			onclick={onCancel}
			class="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
		></button>

		<div
			bind:this={dialog}
			class="surface relative max-h-[85vh] w-full max-w-lg overflow-y-auto border-neutral-700 shadow-2xl"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="artwork-undo-title"
			aria-describedby="artwork-undo-description"
			tabindex="-1"
		>
			<header class="border-b border-neutral-800 px-5 py-4">
				<p class="text-[11px] font-medium tracking-[0.14em] text-accent-300 uppercase">
					{m.item_undo_preview_label()}
				</p>
				<h2 id="artwork-undo-title" class="mt-1 text-lg font-semibold tracking-tight">
					{m.item_undo_dialog_title()}
				</h2>
				<p id="artwork-undo-description" class="mt-1 text-sm text-neutral-400">
					{m.item_undo_dialog_description({ scope: contextLabel })}
				</p>
			</header>

			<div class="space-y-4 px-5 py-4">
				<div class="grid grid-cols-3 gap-2" aria-label={m.item_undo_impact_title()}>
					<div class="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
						<strong class="block text-xl font-semibold text-neutral-100">
							{preview.summary.actionableCount}
						</strong>
						<span class="text-[11px] text-neutral-400">{m.item_undo_changes()}</span>
					</div>
					<div class="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
						<strong class="block text-xl font-semibold text-neutral-100">
							{preview.summary.targetCount}
						</strong>
						<span class="text-[11px] text-neutral-400">{m.item_undo_targets()}</span>
					</div>
					<div class="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
						<strong class="block text-xl font-semibold text-neutral-100">
							{preview.summary.slotCount}
						</strong>
						<span class="text-[11px] text-neutral-400">{m.item_undo_slots()}</span>
					</div>
				</div>

				<div>
					<h3 class="text-xs font-medium text-neutral-200">{m.item_undo_impact_title()}</h3>
					<ul class="mt-2 space-y-1.5 text-sm text-neutral-300">
						{#if preview.summary.destinations.server > 0}
							<li class="flex items-center justify-between gap-3">
								<span>{m.item_history_server()}</span>
								<span class="tabular-nums text-neutral-400"
									>{preview.summary.destinations.server}</span
								>
							</li>
						{/if}
						{#if preview.summary.destinations.kometa > 0}
							<li class="flex items-center justify-between gap-3">
								<span>Kometa</span>
								<span class="tabular-nums text-neutral-400"
									>{preview.summary.destinations.kometa}</span
								>
							</li>
						{/if}
						{#if preview.summary.restoreStates.absent > 0}
							<li class="flex items-center justify-between gap-3">
								<span>{m.item_undo_restore_absent()}</span>
								<span class="tabular-nums text-neutral-400"
									>{preview.summary.restoreStates.absent}</span
								>
							</li>
						{/if}
					</ul>
				</div>

				{#if preview.summary.unavailableCount > 0}
					<p
						class="rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-100"
						role="status"
					>
						{m.item_undo_unavailable_warning({ count: preview.summary.unavailableCount })}
					</p>
				{/if}

				<p class="text-xs text-neutral-400">{m.item_undo_history_preserved()}</p>
			</div>

			<footer class="flex flex-wrap justify-end gap-2 border-t border-neutral-800 px-5 py-4">
				<button
					bind:this={cancelButton}
					type="button"
					class="btn btn-ghost"
					disabled={busy}
					onclick={onCancel}>{m.item_undo_cancel()}</button
				>
				<button
					type="button"
					class="btn btn-accent"
					disabled={busy || preview.summary.actionableCount === 0}
					onclick={onConfirm}
				>
					{busy ? m.item_undo_working() : m.item_undo_confirm()}
				</button>
			</footer>
		</div>
	</div>
{/if}

<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	interface ServerPurgeImpact {
		items: number;
		candidates: number;
		jobs: number;
		jobAttempts: number;
		revisions: number;
		revisionGroups: number;
		snapshots: number;
		snapshotFiles: number;
		collections: number;
		collectionMemberships: number;
		schedules: number;
		scheduleOccurrences: number;
		activeMutatingJobs: number;
		totalRecords: number;
	}

	let {
		open,
		serverName,
		impact,
		blocked,
		busy = false,
		onConfirm,
		onCancel
	}: {
		open: boolean;
		serverName: string;
		impact: ServerPurgeImpact | null;
		blocked: boolean;
		busy?: boolean;
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
				'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

{#if open && impact}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			aria-label={m.server_purge_cancel()}
			disabled={busy}
			onclick={onCancel}
			class="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
		></button>

		<div
			bind:this={dialog}
			class="surface relative max-h-[88vh] w-full max-w-xl overflow-y-auto border-red-900/70 shadow-2xl"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="server-purge-title"
			aria-describedby="server-purge-description"
			tabindex="-1"
		>
			<header class="border-b border-neutral-800 px-5 py-4">
				<p class="text-[11px] font-medium tracking-[0.14em] text-red-300 uppercase">
					{m.server_purge_permanent_label()}
				</p>
				<h2 id="server-purge-title" class="mt-1 text-lg font-semibold tracking-tight">
					{m.server_purge_title({ name: serverName })}
				</h2>
				<p id="server-purge-description" class="mt-1 text-sm text-neutral-400">
					{m.server_purge_description()}
				</p>
			</header>

			<div class="space-y-4 px-5 py-4">
				<div class="rounded-lg border border-red-900/60 bg-red-950/25 p-3">
					<p class="text-sm font-medium text-red-100">{m.server_purge_irreversible()}</p>
					<p class="mt-1 text-xs text-red-200/80">{m.server_purge_scope_only()}</p>
				</div>

				<div>
					<h3 class="text-xs font-medium text-neutral-200">{m.server_purge_impact_title()}</h3>
					<dl class="mt-2 grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
						<div class="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
							<dt class="text-neutral-400">{m.server_purge_items()}</dt>
							<dd class="font-medium tabular-nums">{impact.items}</dd>
						</div>
						<div class="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
							<dt class="text-neutral-400">{m.server_purge_candidates()}</dt>
							<dd class="font-medium tabular-nums">{impact.candidates}</dd>
						</div>
						<div class="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
							<dt class="text-neutral-400">{m.server_purge_history()}</dt>
							<dd class="font-medium tabular-nums">{impact.revisions}</dd>
						</div>
						<div class="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
							<dt class="text-neutral-400">{m.server_purge_snapshots()}</dt>
							<dd class="font-medium tabular-nums">{impact.snapshots}</dd>
						</div>
						<div class="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
							<dt class="text-neutral-400">{m.server_purge_jobs()}</dt>
							<dd class="font-medium tabular-nums">{impact.jobs}</dd>
						</div>
						<div class="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
							<dt class="text-neutral-400">{m.server_purge_automations()}</dt>
							<dd class="font-medium tabular-nums">{impact.schedules}</dd>
						</div>
					</dl>
					<p class="mt-3 text-xs text-neutral-400">
						{m.server_purge_total({ count: impact.totalRecords })}
					</p>
				</div>

				{#if blocked}
					<p
						class="rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-100"
						role="alert"
					>
						{m.server_purge_jobs_blocked({ count: impact.activeMutatingJobs })}
					</p>
				{/if}

				<p class="text-xs text-neutral-400">
					{m.server_purge_backup_hint()}
					<a
						class="ml-1 text-accent-300 underline hover:text-accent-200"
						href="/settings?tab=backup"
					>
						{m.server_purge_open_backups()}
					</a>
				</p>
			</div>

			<footer class="flex flex-wrap justify-end gap-2 border-t border-neutral-800 px-5 py-4">
				<button
					bind:this={cancelButton}
					type="button"
					class="btn btn-ghost"
					disabled={busy}
					onclick={onCancel}>{m.server_purge_cancel()}</button
				>
				<button
					type="button"
					class="btn bg-red-900/70 text-red-100 hover:bg-red-800"
					disabled={busy || blocked}
					onclick={onConfirm}
				>
					{busy ? m.server_purge_deleting() : m.server_purge_confirm()}
				</button>
			</footer>
		</div>
	</div>
{/if}

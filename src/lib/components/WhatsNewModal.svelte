<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { renderReleaseNotes } from '$lib/markdown';

	let {
		open = $bindable(false),
		version = null,
		name = null,
		body = null,
		url
	}: {
		/** Whether the modal is visible. Two-way bound so the parent can close it. */
		open?: boolean;
		/** Release version (e.g. "1.2.0"); used for the fallback title. */
		version?: string | null;
		/** Release display name (GitHub `name`). Falls back to "vX.Y.Z". */
		name?: string | null;
		/** Release notes (GitHub `body`, Markdown rendered as readable text). */
		body?: string | null;
		/** Link to the full release page on GitHub. */
		url: string;
	} = $props();

	let closeButton = $state<HTMLButtonElement | null>(null);
	let dialog = $state<HTMLElement | null>(null);
	let lastFocused: HTMLElement | null = null;

	function close() {
		open = false;
	}

	/** Focusable elements inside the dialog, in DOM order. */
	function focusable(): HTMLElement[] {
		if (!dialog) return [];
		return [
			...dialog.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		];
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		// Trap Tab focus within the dialog so it never lands on background content.
		if (event.key === 'Tab') {
			const items = focusable();
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (event.shiftKey && active === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	const title = $derived(name ?? (version ? `v${version}` : m.whats_new_title()));
	const renderedBody = $derived(body ? renderReleaseNotes(body) : '');

	// On open: remember what had focus, then focus the close button. On close:
	// restore focus to where the user was so they aren't dropped at the top.
	$effect(() => {
		if (open) {
			lastFocused = document.activeElement as HTMLElement | null;
			closeButton?.focus();
		} else if (lastFocused) {
			lastFocused.focus();
			lastFocused = null;
		}
	});
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop: a button so click + keyboard both close the modal accessibly. -->
		<button
			type="button"
			aria-label={m.whats_new_close()}
			tabindex="-1"
			onclick={close}
			class="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
		></button>

		<!-- Dialog -->
		<div
			bind:this={dialog}
			class="surface relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden"
			role="dialog"
			aria-modal="true"
			aria-labelledby="whats-new-title"
			tabindex="-1"
		>
			<div class="flex items-start justify-between gap-3 border-b border-neutral-800 p-4">
				<h2 id="whats-new-title" class="text-lg font-semibold tracking-tight">{title}</h2>
				<button
					bind:this={closeButton}
					type="button"
					onclick={close}
					aria-label={m.whats_new_close()}
					class="btn btn-ghost px-2 py-1 text-sm"
				>
					✕
				</button>
			</div>

			<div class="overflow-y-auto p-4">
				{#if body}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- release notes are HTML-escaped and tag-whitelisted in renderReleaseNotes -->
					<div class="release-notes text-sm text-neutral-300">{@html renderedBody}</div>
				{:else}
					<p class="text-sm text-neutral-400">{m.whats_new_empty()}</p>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-3 border-t border-neutral-800 p-4">
				<a
					href={url}
					target="_blank"
					rel="noopener"
					class="text-sm text-accent-300 underline hover:text-accent-200"
				>
					{m.whats_new_view()}
				</a>
				<button type="button" onclick={close} class="btn btn-subtle px-4 py-2">
					{m.whats_new_close()}
				</button>
			</div>
		</div>
	</div>
{/if}

<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { artworkLanguageName } from '$lib/posters/candidate-disclosure';
	import { providerTagsArtworkLanguage } from '$lib/tmdb-artwork-language';
	import {
		clampPreviewIndex,
		previewBounds,
		resolvePreviewIndex,
		stepPreviewIndex,
		type PreviewArtwork
	} from '$lib/posters/preview-navigation';

	let {
		open = $bindable(false),
		sequence,
		index = 0,
		trigger = null
	}: {
		/** Visibility. Two-way bound so Escape, the close control and the backdrop can close it. */
		open?: boolean;
		/**
		 * The candidates this dialog may walk, in the order the page shows them.
		 *
		 * The parent passes its *already filtered and disclosed* sequence. The
		 * dialog must never re-derive visibility from the retained inventory, or
		 * Next would reach artwork the page itself is hiding behind a language
		 * preference or an unrevealed disclosure batch.
		 */
		sequence: readonly PreviewArtwork[];
		/** Which entry to open at. Read once per opening; navigation after that is the dialog's. */
		index?: number;
		/**
		 * The exact control that opened the dialog, for focus restoration.
		 *
		 * Optional because `document.activeElement` is that same control whenever
		 * activation focused it — but a touch activation does not focus a button on
		 * every engine, and this preview is required to work by touch, so a trigger
		 * that can identify itself should.
		 */
		trigger?: HTMLElement | null;
	} = $props();

	let dialog = $state<HTMLElement | null>(null);
	let closeButton = $state<HTMLButtonElement | null>(null);
	let previousButton = $state<HTMLButtonElement | null>(null);
	let nextButton = $state<HTMLButtonElement | null>(null);

	/** Index of the artwork currently on screen. */
	let cursor = $state(0);
	/**
	 * The id is what survives a sequence change: an ordinal is meaningless once
	 * the page reveals another batch or refilters, but the candidate the user is
	 * actually looking at is the same object.
	 */
	let anchorId = $state<number | null>(null);
	let failed = $state(false);

	/** Where focus goes when the dialog closes — the trigger, not the top of the page. */
	let restoreTarget: HTMLElement | null = null;
	let wasOpen = false;

	const artwork = $derived(sequence[cursor] ?? null);
	const bounds = $derived(previewBounds(cursor, sequence.length));
	const position = $derived(
		m.item_preview_position({ position: bounds.position, total: bounds.total })
	);

	/**
	 * Provider, dimensions and language — the provenance that decides whether this
	 * candidate is worth staging, which a bare enlarged image cannot convey.
	 * Untagged artwork says so rather than showing a gap.
	 */
	const details = $derived.by(() => {
		if (!artwork) return '';
		const parts = [artwork.provider];
		if (artwork.width && artwork.height) parts.push(`${artwork.width} × ${artwork.height}`);
		// Only providers that report a language get a language line at all: saying
		// "no language tag" for MediUX would describe the source, not this artwork,
		// on every candidate it will ever return.
		//
		// Within those, provenance decides the wording. `untagged` is the provider
		// stating the artwork is textless — useful. `unknown` is a row stored before
		// provenance existed, which is missing data and says so, matching how the
		// item page labels the same candidates.
		if (artwork.languageProvenance === 'tagged' && artwork.language) {
			parts.push(artworkLanguageName(artwork.language));
		} else if (providerTagsArtworkLanguage(artwork.provider)) {
			parts.push(
				artwork.languageProvenance === 'untagged'
					? m.item_preview_untagged()
					: m.item_language_unverified()
			);
		}
		return parts.join(' · ');
	});

	function close(): void {
		open = false;
	}

	async function move(step: number): Promise<void> {
		const target = stepPreviewIndex(cursor, sequence.length, step);
		if (target < 0 || target === cursor) return;
		const pressed = document.activeElement;
		cursor = target;
		anchorId = sequence[target].id;

		// Reaching a bound disables the control that was just pressed, and a disabled
		// control drops focus to <body> — the regression the provider-order control
		// shipped once already. Hand focus to the sibling that is still live so the
		// sequence stays walkable from the keyboard and the trap keeps two ends.
		await tick();
		if (pressed === previousButton && !bounds.hasPrevious) nextButton?.focus();
		else if (pressed === nextButton && !bounds.hasNext) previousButton?.focus();
	}

	/** Focusable controls inside the dialog, in DOM order. Recomputed per keystroke
	    because the navigation controls disable themselves at the sequence bounds. */
	function focusable(): HTMLElement[] {
		if (!dialog) return [];
		return [
			...dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
			)
		];
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		// Unmodified arrows only, matching `review-shortcuts`: Alt+Left and Alt+Right
		// are browser back and forward, and swallowing them to change artwork would
		// take away navigation the user expects to work everywhere.
		const modified = event.altKey || event.ctrlKey || event.metaKey;
		if (!modified && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			event.preventDefault();
			void move(event.key === 'ArrowLeft' ? -1 : 1);
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
		// Focus that already escaped the dialog — a stray programmatic focus, or a
		// control removed under the cursor — is pulled back rather than left to Tab
		// on through the page behind the modal.
		if (!active || !dialog?.contains(active)) {
			event.preventDefault();
			first.focus();
		} else if (event.shiftKey && (active === first || active === dialog)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (active === last || active === dialog)) {
			event.preventDefault();
			first.focus();
		}
	}

	// Opening seeds the cursor from the parent's request; every later run is the
	// sequence moving underneath an open dialog. `index` and the cursor state are
	// untracked so the effect's only triggers are `open` and `sequence` — writing
	// the cursor back must not re-enter this.
	$effect(() => {
		if (!open) {
			if (wasOpen) {
				wasOpen = false;
				if (restoreTarget?.isConnected) restoreTarget.focus();
				restoreTarget = null;
			}
			return;
		}
		if (!wasOpen) {
			wasOpen = true;
			restoreTarget = untrack(() => trigger) ?? (document.activeElement as HTMLElement | null);
			// Nothing to enlarge is not a dialog worth trapping focus in.
			if (sequence.length === 0) {
				close();
				return;
			}
			cursor = clampPreviewIndex(
				untrack(() => index),
				sequence.length
			);
			anchorId = sequence[cursor].id;
			// After the dialog paints, so focus lands on a control that exists.
			queueMicrotask(() => closeButton?.focus());
			return;
		}
		const resolved = resolvePreviewIndex(
			sequence,
			untrack(() => anchorId),
			untrack(() => cursor)
		);
		if (resolved === null) {
			close();
			return;
		}
		cursor = resolved;
		anchorId = sequence[resolved].id;
	});

	// A new asset re-arms the load state; without this one candidate's failure
	// would keep showing over the next candidate's perfectly good image.
	$effect(() => {
		if (artwork?.url) failed = false;
	});

	// The dialog owns the viewport while it is open, so the page behind it must not
	// scroll under the backdrop.
	$effect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open && artwork}
	<!-- `aria-modal` is load-bearing beyond assistive tech: the item page's review
	     shortcut handler treats any `[aria-modal="true"]` in the document as a
	     suspension signal, so J/K/S/C/I/A stop acting on the page behind this. -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
		<button
			type="button"
			tabindex="-1"
			aria-label={m.item_preview_close()}
			onclick={close}
			class="absolute inset-0 cursor-default bg-black/85"
		></button>

		<div
			bind:this={dialog}
			id="artwork-preview-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="artwork-preview-title"
			aria-describedby="artwork-preview-details"
			tabindex="-1"
			class="surface relative flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden border-neutral-700 bg-neutral-950/95 shadow-2xl"
		>
			<header class="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3">
				<div class="min-w-0">
					<h2 id="artwork-preview-title" class="text-sm font-semibold tracking-tight">
						{m.item_preview_title()}
					</h2>
					<!-- Provenance is what makes an enlarged image judgeable, so it wraps
					     rather than truncating and describes the dialog itself. -->
					<p id="artwork-preview-details" class="mt-0.5 text-xs text-neutral-400">{details}</p>
				</div>
				<button
					bind:this={closeButton}
					type="button"
					id="artwork-preview-close"
					onclick={close}
					aria-label={m.item_preview_close()}
					class="btn btn-ghost min-h-11 min-w-11 shrink-0"
				>
					<span aria-hidden="true">✕</span>
				</button>
			</header>

			<!-- The canonical asset, complete and uncropped. It is fetched straight from
			     the provider rather than through /api/thumb: that proxy exists to cache
			     grid-sized previews on disk, and filling it with originals would evict
			     the thumbnails it is there to serve. Mounted only inside `{#if open}`,
			     so a grid of a hundred tiles downloads a hundred thumbnails and zero
			     originals until someone asks for one. -->
			<!-- Two elements, deliberately: the outer one is the flex child that gets a
			     height, the inner one turns that into a concrete box via `inset-0`. A
			     percentage height on the image resolves against `auto` otherwise — it
			     silently falls back to the asset's natural size, which overflowed the
			     dialog and cropped exactly what this view exists to show in full. -->
			<div class="relative min-h-0 flex-1 overflow-hidden bg-black">
				<div class="absolute inset-0 flex items-center justify-center">
					{#if failed}
						<p
							role="alert"
							class="flex max-w-sm items-start gap-2 rounded-lg border border-red-800/70 bg-red-950/40 p-3 text-sm text-red-100"
						>
							<span aria-hidden="true">⚠</span>
							{m.item_preview_failed()}
						</p>
					{:else}
						{#key artwork.id}
							<!-- Empty alt by necessity, not by neglect: nothing here can describe the
						     artwork's content. The dialog carries its own name, the trigger already
						     named the kind and provider, and the metadata line above repeats both. -->
							<img
								id="artwork-preview-image"
								src={artwork.url}
								alt=""
								decoding="async"
								onerror={() => (failed = true)}
								class="absolute inset-0 size-full object-contain p-2 sm:p-4"
							/>
						{/key}
					{/if}
				</div>
			</div>

			<footer
				class="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 px-4 py-3"
			>
				<button
					bind:this={previousButton}
					type="button"
					id="artwork-preview-previous"
					onclick={() => void move(-1)}
					disabled={!bounds.hasPrevious}
					aria-label={m.item_preview_previous()}
					aria-keyshortcuts="ArrowLeft"
					class="btn btn-ghost min-h-11 min-w-11"
				>
					<span aria-hidden="true">←</span>
				</button>

				<!-- Position is announced politely rather than only drawn: navigating with
				     the keyboard moves nothing else that assistive tech would report. -->
				<p aria-live="polite" class="text-xs tabular-nums text-neutral-300" data-preview-position>
					{position}
				</p>

				<button
					bind:this={nextButton}
					type="button"
					id="artwork-preview-next"
					onclick={() => void move(1)}
					disabled={!bounds.hasNext}
					aria-label={m.item_preview_next()}
					aria-keyshortcuts="ArrowRight"
					class="btn btn-ghost min-h-11 min-w-11"
				>
					<span aria-hidden="true">→</span>
				</button>
			</footer>
		</div>
	</div>
{/if}

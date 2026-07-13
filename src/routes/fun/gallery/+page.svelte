<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { galleryAutoAdvanceAllowed } from '$lib/fun-gallery-playback';
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let active = $state(false);
	let paused = $state(false);
	let reducedMotion = $state(false);
	let reducedMotionPlaybackEnabled = $state(false);
	let index = $state(0);
	let galleryElement: HTMLElement | null = $state(null);
	let galleryTrigger: HTMLButtonElement | null = $state(null);
	let restoreFocusElement: HTMLElement | null = null;
	const failed = new SvelteSet<string>();
	const current = $derived(data.slides[index] ?? null);

	onMount(() => {
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reducedMotion) paused = true;
	});

	function move(direction: 1 | -1) {
		if (!data.slides.length) return;
		for (let attempts = 0; attempts < data.slides.length; attempts += 1) {
			index = (index + direction + data.slides.length) % data.slides.length;
			if (!failed.has(data.slides[index].id)) return;
		}
		paused = true;
	}

	function failCurrent() {
		if (!current || failed.has(current.id)) return;
		failed.add(current.id);
		if (failed.size >= data.slides.length) paused = true;
		move(1);
	}

	function togglePlayback() {
		if (paused && reducedMotion) reducedMotionPlaybackEnabled = true;
		paused = !paused;
	}

	async function openGallery() {
		restoreFocusElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : galleryTrigger;
		active = true;
		index = 0;
		reducedMotionPlaybackEnabled = false;
		paused = reducedMotion;
		await tick();
		galleryElement?.focus();
		try {
			await galleryElement?.requestFullscreen?.();
		} catch {
			// Fullscreen permission is optional; the fixed overlay is still full-window.
		}
	}

	async function closeGallery() {
		active = false;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
		} catch {
			// The overlay closes even if the browser rejects exitFullscreen.
		}
		await tick();
		(restoreFocusElement ?? galleryTrigger)?.focus();
		restoreFocusElement = null;
	}

	function onKeydown(event: KeyboardEvent) {
		if (!active) return;
		if (event.key === 'Tab') {
			const focusable = galleryElement
				? Array.from(
						galleryElement.querySelectorAll<HTMLElement>(
							'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
						)
					)
				: [];
			if (focusable.length === 0) {
				event.preventDefault();
				galleryElement?.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (
				event.shiftKey &&
				(document.activeElement === first || document.activeElement === galleryElement)
			) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		} else if (event.key === 'Escape') void closeGallery();
		else if (event.key === 'ArrowRight') move(1);
		else if (event.key === 'ArrowLeft') move(-1);
		else if (event.key === ' ' && event.target === galleryElement) {
			event.preventDefault();
			togglePlayback();
		}
	}

	$effect(() => {
		if (
			!galleryAutoAdvanceAllowed({
				active,
				paused,
				reducedMotion,
				reducedMotionPlaybackEnabled,
				slideCount: data.slides.length
			})
		)
			return;
		const timer = window.setInterval(() => move(1), data.intervalSeconds * 1000);
		return () => window.clearInterval(timer);
	});
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>{m.fun_gallery_title()} · PosterPilot</title></svelte:head>

<section class="space-y-6">
	<header>
		<h2 class="text-xl font-semibold tracking-tight text-white">{m.fun_gallery_title()}</h2>
		<p class="mt-1 text-sm text-neutral-400">{m.fun_gallery_subtitle()}</p>
	</header>

	<form method="GET" action="/fun/gallery" class="surface space-y-4 p-5">
		<input type="hidden" name="seed" value={data.seed} />
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			<label>
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_gallery_artwork()}</span>
				<select
					name="artwork"
					value={data.mode}
					aria-label={m.fun_gallery_artwork()}
					class="input w-full"
				>
					<option value="mixed">{m.fun_gallery_mixed()}</option>
					<option value="poster">{m.item_posters()}</option>
					<option value="background">{m.item_backdrops()}</option>
				</select>
			</label>
			<label>
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_gallery_interval()}</span>
				<select
					name="interval"
					value={data.intervalSeconds}
					aria-label={m.fun_gallery_interval()}
					class="input w-full"
				>
					{#each [3, 5, 8, 12, 20] as seconds (seconds)}
						<option value={seconds}>{m.fun_gallery_seconds({ count: seconds })}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_library_label()}</span>
				<select
					name="library"
					value={data.filter.librarySectionKey ?? ''}
					aria-label={m.fun_library_label()}
					class="input w-full"
				>
					<option value="">{m.fun_library_all()}</option>
					{#each data.libraries as library (`${library.key}:${library.type}`)}
						<option value={library.key}>{library.key}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_type_label()}</span>
				<select
					name="type"
					value={data.filter.type ?? ''}
					aria-label={m.fun_type_label()}
					class="input w-full"
				>
					<option value="">{m.fun_type_both()}</option>
					<option value="movie">{m.library_type_movies()}</option>
					<option value="show">{m.library_type_shows()}</option>
				</select>
			</label>
			<label>
				<span class="mb-1 block text-xs text-neutral-400">{m.fun_genre_label()}</span>
				<select
					name="genre"
					value={data.filter.genre ?? ''}
					aria-label={m.fun_genre_label()}
					class="input w-full"
				>
					<option value="">{m.fun_genre_all()}</option>
					{#each data.genres as genre (genre)}<option value={genre}>{genre}</option>{/each}
				</select>
			</label>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-4">
			<p class="text-xs text-neutral-500">{m.fun_gallery_count({ count: data.slides.length })}</p>
			<div class="flex gap-2">
				<button type="submit" class="btn btn-ghost">{m.library_apply_filters()}</button>
				<button
					bind:this={galleryTrigger}
					type="button"
					onclick={openGallery}
					disabled={!data.slides.length}
					class="btn btn-accent"
				>
					{m.fun_gallery_start()}
				</button>
			</div>
		</div>
	</form>

	<div class="surface overflow-hidden">
		{#if data.slides[0]}
			<img
				src={`/api/artwork/${data.slides[0].itemId}/${data.slides[0].kind}?v=${data.slides[0].artworkVersion}`}
				alt=""
				class="aspect-video w-full object-cover opacity-70"
			/>
		{:else}
			<div class="p-10 text-center text-sm text-neutral-400">{m.fun_gallery_empty()}</div>
		{/if}
	</div>
</section>

{#if active}
	<div
		bind:this={galleryElement}
		role="dialog"
		aria-modal="true"
		aria-label={m.fun_gallery_title()}
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black"
	>
		{#if current && !failed.has(current.id)}
			<img
				src={`/api/artwork/${current.itemId}/${current.kind}?v=${current.artworkVersion}`}
				alt={current.title}
				onerror={failCurrent}
				class="h-full w-full {current.kind === 'poster'
					? 'object-contain'
					: 'object-cover'} {reducedMotion ? '' : 'transition-opacity duration-700'}"
			/>
			<div
				class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-6 pt-24"
			>
				<p class="text-lg font-medium text-white">{current.title}</p>
				<p class="mt-1 text-xs text-neutral-400">{index + 1} / {data.slides.length}</p>
			</div>
		{:else}
			<p class="px-6 text-center text-sm text-neutral-300">{m.fun_gallery_empty()}</p>
		{/if}
		<div class="absolute top-4 right-4 flex gap-2">
			<button
				type="button"
				onclick={() => move(-1)}
				class="btn bg-black/70"
				aria-label={m.fun_gallery_previous()}>←</button
			>
			<button type="button" onclick={togglePlayback} aria-pressed={paused} class="btn bg-black/70">
				{paused ? m.fun_gallery_play() : m.fun_gallery_pause()}
			</button>
			<button
				type="button"
				onclick={() => move(1)}
				class="btn bg-black/70"
				aria-label={m.fun_gallery_next()}>→</button
			>
			<button type="button" onclick={closeGallery} class="btn bg-black/70"
				>{m.whats_new_close()}</button
			>
		</div>
		<p class="sr-only" aria-live="polite" aria-atomic="true">
			{current && !failed.has(current.id) ? current.title : m.fun_gallery_empty()}
		</p>
	</div>
{/if}

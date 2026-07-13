<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	function providerName(provider: string | null): string {
		switch (provider) {
			case 'plex':
				return 'Plex';
			case 'jellyfin':
				return 'Jellyfin';
			case 'emby':
				return 'Emby';
			default:
				return provider ?? m.collections_source_server_unknown();
		}
	}

	function sourceLabel(source: 'tmdb' | 'native', nativeProvider: string | null): string {
		return source === 'tmdb'
			? m.collections_source_tmdb()
			: m.collections_source_native({ provider: providerName(nativeProvider) });
	}

	function percentage(covered: number, total: number): number {
		return total === 0 ? 0 : Math.round((covered / total) * 100);
	}
</script>

<svelte:head>
	<title>{m.collections_title()} · {m.app_name()}</title>
</svelte:head>

<div class="py-2">
	<header class="mb-8 max-w-3xl">
		<p class="mb-2 text-xs font-semibold tracking-[0.18em] text-accent-300 uppercase">
			{m.collections_eyebrow()}
		</p>
		<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">{m.collections_title()}</h1>
		<p class="mt-3 text-sm leading-6 text-neutral-300">{m.collections_intro()}</p>
		{#if data.serverName}
			<p class="mt-3 text-xs text-neutral-400">
				{m.collections_server_scope({ server: data.serverName })}
			</p>
		{/if}
	</header>

	{#if data.collections.length === 0}
		<section class="surface flex min-h-72 items-center justify-center px-6 py-12 text-center">
			<div class="max-w-md">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-xl text-neutral-300"
					aria-hidden="true"
				>
					◫
				</div>
				<h2 class="text-lg font-semibold">{m.collections_empty_title()}</h2>
				<p class="mt-2 text-sm leading-6 text-neutral-400">{m.collections_empty_hint()}</p>
				<a class="btn btn-ghost mt-5" href="/library">{m.collections_open_library()}</a>
			</div>
		</section>
	{:else}
		<p class="mb-4 text-sm text-neutral-400" aria-live="polite">
			{m.collections_count({ count: data.collections.length })}
		</p>
		<div class="grid gap-5 lg:grid-cols-2">
			{#each data.collections as collection (collection.id)}
				<a
					href={`/collections/${encodeURIComponent(collection.id)}`}
					class="group surface relative overflow-hidden transition-colors hover:border-neutral-600"
					aria-label={m.collections_open_named({ name: collection.name })}
				>
					{#if collection.heroBackgroundItemId}
						<img
							src={`/api/artwork/${collection.heroBackgroundItemId}/background`}
							alt=""
							class="absolute inset-0 h-48 w-full object-cover opacity-25"
							loading="lazy"
						/>
					{/if}
					<div
						class="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/15 via-neutral-950/75 to-neutral-950"
					></div>

					<div class="relative grid grid-cols-4 gap-1.5 p-4 pb-0 sm:gap-2 sm:p-5 sm:pb-0">
						{#each collection.previewMembers as member (member.id)}
							<div
								class="aspect-[2/3] overflow-hidden rounded-md border border-neutral-700 bg-neutral-950 shadow-lg"
							>
								{#if member.hasCurrentPoster}
									<img
										src={`/api/artwork/${member.id}/poster?v=${member.artworkVersion}`}
										alt={m.collections_preview_alt({ title: member.title })}
										class="h-full w-full object-cover"
										loading="lazy"
										decoding="async"
									/>
								{:else if member.hasStagedPoster}
									<img
										src={`/api/collections/items/${member.id}/staged/poster?v=${member.selectionVersion}`}
										alt={m.collections_preview_staged_alt({ title: member.title })}
										class="h-full w-full object-cover"
										loading="lazy"
										decoding="async"
									/>
								{:else}
									<div
										class="flex h-full items-center justify-center px-2 text-center text-[10px] text-neutral-400"
									>
										{m.collection_no_artwork()}
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<div class="relative p-5 pt-4">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<span class="badge badge-muted mb-2">
									◎ {sourceLabel(collection.source, collection.nativeProvider)}
								</span>
								<h2 class="truncate text-xl font-semibold text-neutral-50 group-hover:text-white">
									{collection.name}
								</h2>
								<p class="mt-1 text-xs text-neutral-400">
									{m.collections_members_summary({
										local: collection.localMemberCount,
										unavailable: collection.unavailableMemberCount
									})}
								</p>
							</div>
							<span class="text-sm font-medium text-accent-300" aria-hidden="true">→</span>
						</div>

						<div class="mt-5 grid gap-3 sm:grid-cols-2">
							<div>
								<div class="mb-1.5 flex justify-between gap-3 text-xs text-neutral-300">
									<span>{m.collection_poster()}</span>
									<span
										>{m.collections_artwork_coverage({
											covered: collection.posterArtworkCount,
											total: collection.localMemberCount
										})}</span
									>
								</div>
								<progress
									class="h-1.5 w-full accent-accent-500"
									max="100"
									value={percentage(collection.posterArtworkCount, collection.localMemberCount)}
									aria-label={m.collections_poster_coverage()}
								></progress>
							</div>
							<div>
								<div class="mb-1.5 flex justify-between gap-3 text-xs text-neutral-300">
									<span>{m.collection_background()}</span>
									<span
										>{m.collections_artwork_coverage({
											covered: collection.backgroundArtworkCount,
											total: collection.localMemberCount
										})}</span
									>
								</div>
								<progress
									class="h-1.5 w-full accent-accent-500"
									max="100"
									value={percentage(collection.backgroundArtworkCount, collection.localMemberCount)}
									aria-label={m.collections_background_coverage()}
								></progress>
							</div>
						</div>
						{#if collection.stagedMemberCount > 0}
							<p class="mt-4 text-xs text-emerald-300">
								✓ {m.collections_staged_summary({ count: collection.stagedMemberCount })}
							</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

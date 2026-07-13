<script lang="ts">
	import { LIBRARY_SORTS, type LibrarySort } from '$lib/library-sort';
	import { m } from '$lib/paraglide/messages';
	import { sortLabels } from '$lib/sort-labels';

	type RankingProvider = 'mediux' | 'theposterdb' | 'fanarttv' | 'tmdb';

	let {
		servers,
		env,
		serverLabel,
		rankingSource,
		kometaServerInstanceId = $bindable(),
		kometaAssetsDir = $bindable(),
		mediuxDelayMs = $bindable(),
		mediuxConcurrency = $bindable(),
		httpCacheTtlDays = $bindable(),
		defaultApplyMethod = $bindable(),
		providerPriority = $bindable(),
		scoreWeightInputs = $bindable(),
		scoreResolution = $bindable(),
		scoreAspect = $bindable(),
		applyConcurrency = $bindable(),
		thumbCacheTtlDays = $bindable(),
		thumbCacheMaxMb = $bindable(),
		suggestPreselect = $bindable(),
		incrementalSync = $bindable(),
		funEnabled = $bindable(),
		libraryDefaultSort = $bindable()
	}: {
		servers: {
			id: string;
			name: string;
			type: 'plex' | 'jellyfin' | 'emby';
			enabled: boolean;
			disconnectedAt: string | Date | null;
		}[];
		env: Record<string, boolean>;
		serverLabel: string;
		rankingSource: { providerPriority: string; weights: string };
		kometaServerInstanceId: string;
		kometaAssetsDir: string;
		mediuxDelayMs: string | number;
		mediuxConcurrency: string | number;
		httpCacheTtlDays: string | number;
		defaultApplyMethod: string;
		providerPriority: RankingProvider[];
		scoreWeightInputs: Record<RankingProvider, string>;
		scoreResolution: string | number;
		scoreAspect: string | number;
		applyConcurrency: string | number;
		thumbCacheTtlDays: string | number;
		thumbCacheMaxMb: string | number;
		suggestPreselect: boolean;
		incrementalSync: boolean;
		funEnabled: boolean;
		libraryDefaultSort: LibrarySort;
	} = $props();

	const rankingProviderLabels: Record<RankingProvider, string> = {
		mediux: 'MediUX',
		theposterdb: 'ThePosterDB',
		fanarttv: 'Fanart.tv',
		tmdb: 'TMDB'
	};

	function moveRankingProvider(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= providerPriority.length) return;
		const next = [...providerPriority];
		[next[index], next[target]] = [next[target], next[index]];
		providerPriority = next;
	}
</script>

<div>
	<label for="kometaServerInstanceId" class="mb-1 block text-sm font-medium">
		{m.settings_kometa_server()}
	</label>
	<select
		id="kometaServerInstanceId"
		bind:value={kometaServerInstanceId}
		disabled={env.kometaServerInstanceId}
		class="input w-full disabled:opacity-50"
	>
		<option value="">{m.settings_kometa_server_choose()}</option>
		{#each servers.filter((server) => server.type === 'plex' && server.enabled && server.disconnectedAt === null) as server (server.id)}
			<option value={server.id}>{server.name} · Plex</option>
		{/each}
	</select>
	<p class="mt-1 text-xs text-neutral-400">{m.settings_kometa_server_hint()}</p>
	{#if env.kometaServerInstanceId}<p class="mt-1 text-xs text-amber-400">
			{m.settings_set_from_env()}
		</p>{/if}
</div>

<div>
	<label for="kometaAssetsDir" class="mb-1 block text-sm font-medium">
		{m.settings_kometa_dir()}
	</label>
	<input
		id="kometaAssetsDir"
		bind:value={kometaAssetsDir}
		disabled={env.kometaAssetsDir}
		class="input w-full disabled:opacity-50"
	/>
	<p class="mt-1 text-xs text-neutral-400">{m.settings_kometa_dir_hint()}</p>
	<p class="mt-1 text-xs text-neutral-400">
		{m.settings_kometa_manager_pointer()}
		<a href="/kometa" class="text-accent-300 underline">{m.nav_kometa()}</a>
	</p>
</div>

<div class="grid grid-cols-3 gap-3">
	<div>
		<label for="delay" class="mb-1 block text-sm font-medium">{m.settings_delay()}</label>
		<input
			id="delay"
			type="number"
			inputmode="numeric"
			min="0"
			step="1"
			bind:value={mediuxDelayMs}
			class="input w-full"
		/>
	</div>
	<div>
		<label for="conc" class="mb-1 block text-sm font-medium">{m.settings_concurrency()}</label>
		<input
			id="conc"
			type="number"
			inputmode="numeric"
			min="1"
			step="1"
			bind:value={mediuxConcurrency}
			class="input w-full"
		/>
	</div>
	<div>
		<label for="ttl" class="mb-1 block text-sm font-medium">{m.settings_cache_days()}</label>
		<input
			id="ttl"
			type="number"
			inputmode="numeric"
			min="0"
			step="1"
			bind:value={httpCacheTtlDays}
			class="input w-full"
		/>
	</div>
</div>

<div>
	<label for="method" class="mb-1 block text-sm font-medium">
		{m.settings_default_apply_method()}
	</label>
	<select
		id="method"
		bind:value={defaultApplyMethod}
		disabled={env.defaultApplyMethod}
		class="input disabled:opacity-50"
	>
		<option value="both">{m.settings_method_both({ server: serverLabel })}</option>
		<option value="plex">{m.settings_method_server_only({ server: serverLabel })}</option>
		<option value="kometa">{m.settings_method_kometa_only()}</option>
	</select>
	{#if env.defaultApplyMethod}<p class="mt-1 text-xs text-amber-400">
			{m.settings_set_from_env()}
		</p>{/if}
</div>

<div class="border-t border-neutral-800 pt-4">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div>
			<h2 class="text-sm font-semibold">{m.settings_artwork_ranking()}</h2>
			<p class="mt-1 max-w-2xl text-xs text-neutral-400">
				{m.settings_artwork_ranking_hint()}
			</p>
		</div>
		<span class="badge badge-info">
			{rankingSource.providerPriority === 'stored' || rankingSource.weights === 'stored'
				? m.settings_ranking_saved()
				: m.settings_ranking_defaults()}
		</span>
	</div>

	<div class="mt-4 space-y-2">
		{#each providerPriority as provider, index (provider)}
			<div
				class="grid items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 sm:grid-cols-[2rem_1fr_8rem_auto]"
			>
				<span class="text-center text-xs font-semibold text-neutral-500" aria-hidden="true">
					{index + 1}
				</span>
				<label class="text-sm text-neutral-200" for={`score-${provider}`}>
					{rankingProviderLabels[provider]}
				</label>
				<input
					id={`score-${provider}`}
					type="number"
					min="0"
					max="10"
					step="0.1"
					value={scoreWeightInputs[provider]}
					oninput={(event) => (scoreWeightInputs[provider] = event.currentTarget.value)}
					class="input w-full"
				/>
				<div class="flex gap-1">
					<button
						type="button"
						class="btn btn-ghost px-2"
						disabled={index === 0}
						aria-label={m.settings_priority_up({
							provider: rankingProviderLabels[provider]
						})}
						onclick={() => moveRankingProvider(index, -1)}>↑</button
					>
					<button
						type="button"
						class="btn btn-ghost px-2"
						disabled={index === providerPriority.length - 1}
						aria-label={m.settings_priority_down({
							provider: rankingProviderLabels[provider]
						})}
						onclick={() => moveRankingProvider(index, 1)}>↓</button
					>
				</div>
			</div>
		{/each}
	</div>

	<div class="mt-3 grid gap-3 sm:grid-cols-2">
		<label class="text-sm text-neutral-300" for="score-resolution">
			{m.settings_score_resolution()}
			<input
				id="score-resolution"
				type="number"
				min="0"
				max="10"
				step="0.1"
				bind:value={scoreResolution}
				class="input mt-1 w-full"
			/>
		</label>
		<label class="text-sm text-neutral-300" for="score-aspect">
			{m.settings_score_aspect()}
			<input
				id="score-aspect"
				type="number"
				min="0"
				max="10"
				step="0.1"
				bind:value={scoreAspect}
				class="input mt-1 w-full"
			/>
		</label>
	</div>
	<p class="mt-2 text-xs text-neutral-500">{m.settings_score_range()}</p>
</div>

<div class="border-t border-neutral-800 pt-4">
	<h2 class="text-sm font-semibold">{m.settings_performance()}</h2>
	<p class="mt-1 text-xs text-neutral-400">{m.settings_performance_hint()}</p>

	<div class="mt-3 grid grid-cols-3 gap-3">
		<div>
			<label for="applyConc" class="mb-1 block text-sm font-medium">
				{m.settings_apply_concurrency()}
			</label>
			<input
				id="applyConc"
				type="number"
				inputmode="numeric"
				min="1"
				max="16"
				step="1"
				bind:value={applyConcurrency}
				disabled={env.applyConcurrency}
				class="input w-full disabled:opacity-50"
			/>
			{#if env.applyConcurrency}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
		</div>
		<div>
			<label for="thumbTtl" class="mb-1 block text-sm font-medium">
				{m.settings_thumb_cache_ttl()}
			</label>
			<input
				id="thumbTtl"
				type="number"
				inputmode="numeric"
				min="0"
				step="1"
				bind:value={thumbCacheTtlDays}
				disabled={env.thumbCacheTtlDays}
				class="input w-full disabled:opacity-50"
			/>
			{#if env.thumbCacheTtlDays}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
		</div>
		<div>
			<label for="thumbMax" class="mb-1 block text-sm font-medium">
				{m.settings_thumb_cache_max()}
			</label>
			<input
				id="thumbMax"
				type="number"
				inputmode="numeric"
				min="0"
				step="1"
				bind:value={thumbCacheMaxMb}
				disabled={env.thumbCacheMaxMb}
				class="input w-full disabled:opacity-50"
			/>
			{#if env.thumbCacheMaxMb}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
		</div>
	</div>

	<div class="mt-3 space-y-1">
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input type="checkbox" bind:checked={suggestPreselect} disabled={env.suggestPreselect} />
			{m.settings_suggest_preselect()}
		</label>
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input type="checkbox" bind:checked={incrementalSync} disabled={env.incrementalSync} />
			{m.settings_incremental_sync()}
		</label>
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input type="checkbox" bind:checked={funEnabled} disabled={env.funEnabled} />
			{m.settings_fun_enabled()}
		</label>
		{#if env.funEnabled}<p class="text-xs text-amber-400">{m.settings_set_from_env()}</p>{/if}
	</div>

	<div class="mt-4 max-w-xs">
		<label for="libraryDefaultSort" class="mb-1 block text-sm font-medium">
			{m.settings_library_default_sort()}
		</label>
		<select
			id="libraryDefaultSort"
			bind:value={libraryDefaultSort}
			disabled={env.libraryDefaultSort}
			class="input w-full disabled:opacity-50"
		>
			{#each LIBRARY_SORTS as sort (sort)}
				<option value={sort}>{sortLabels[sort]()}</option>
			{/each}
		</select>
		{#if env.libraryDefaultSort}<p class="mt-1 text-xs text-amber-400">
				{m.settings_set_from_env()}
			</p>{/if}
	</div>
</div>

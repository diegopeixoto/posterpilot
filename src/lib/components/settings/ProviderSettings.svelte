<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let {
		tmdbKey = $bindable(),
		tmdbKeySet,
		providerMediux = $bindable(),
		providerTmdb = $bindable(),
		providerFanart = $bindable(),
		providerThePosterDb = $bindable(),
		fanartKey = $bindable(),
		fanartKeySet,
		env
	}: {
		tmdbKey: string;
		tmdbKeySet: boolean;
		providerMediux: boolean;
		providerTmdb: boolean;
		providerFanart: boolean;
		providerThePosterDb: boolean;
		fanartKey: string;
		fanartKeySet: boolean;
		env: Record<string, boolean>;
	} = $props();
</script>

<div>
	<label for="tmdbKey" class="mb-1 block text-sm font-medium">{m.settings_tmdb_key()}</label>
	<input
		id="tmdbKey"
		type="password"
		bind:value={tmdbKey}
		disabled={env.tmdbKey}
		placeholder={tmdbKeySet
			? m.settings_secret_placeholder_set()
			: m.settings_tmdb_key_placeholder_unset()}
		class="input w-full disabled:opacity-50"
	/>
	{#if env.tmdbKey}<p class="mt-1 text-xs text-amber-400">{m.settings_set_from_env()}</p>{/if}
</div>

<div>
	<span class="mb-1 block text-sm font-medium">{m.settings_providers()}</span>
	<p class="mb-2 text-xs text-neutral-400">{m.settings_providers_hint()}</p>
	<div class="space-y-1">
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input type="checkbox" bind:checked={providerMediux} disabled={env.providerMediux} />
			{m.settings_provider_mediux()}
		</label>
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input type="checkbox" bind:checked={providerTmdb} disabled={env.providerTmdb} />
			{m.settings_provider_tmdb()}
		</label>
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input type="checkbox" bind:checked={providerFanart} disabled={env.providerFanart} />
			{m.settings_provider_fanart()}
		</label>
		<label class="flex items-center gap-2 text-sm text-neutral-300">
			<input
				type="checkbox"
				bind:checked={providerThePosterDb}
				disabled={env.providerThePosterDb}
			/>
			{m.settings_provider_theposterdb()}
			<span class="text-xs text-neutral-400">{m.settings_experimental()}</span>
		</label>
	</div>
	<div class="mt-3">
		<label for="fanartKey" class="mb-1 block text-sm font-medium">{m.settings_fanart_key()}</label>
		<input
			id="fanartKey"
			type="password"
			bind:value={fanartKey}
			disabled={env.fanartKey}
			placeholder={fanartKeySet
				? m.settings_secret_placeholder_set()
				: m.settings_fanart_key_placeholder_unset()}
			class="input w-full disabled:opacity-50"
		/>
		{#if env.fanartKey}<p class="mt-1 text-xs text-amber-400">{m.settings_set_from_env()}</p>{/if}
	</div>
</div>

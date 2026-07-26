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
		thePosterDbUsername = $bindable(),
		thePosterDbPassword = $bindable(),
		thePosterDbPasswordSet,
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
		thePosterDbUsername: string;
		thePosterDbPassword: string;
		thePosterDbPasswordSet: boolean;
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
	{#if providerThePosterDb}
		<div class="mt-3 space-y-2 rounded-md border border-neutral-800 p-3">
			<p class="text-xs text-neutral-400">{m.settings_theposterdb_auth_hint()}</p>
			<div>
				<label for="thePosterDbUsername" class="mb-1 block text-sm font-medium"
					>{m.settings_theposterdb_username()}</label
				>
				<input
					id="thePosterDbUsername"
					type="text"
					autocomplete="off"
					bind:value={thePosterDbUsername}
					disabled={env.thePosterDbUsername}
					placeholder={m.settings_theposterdb_username_placeholder()}
					class="input w-full disabled:opacity-50"
				/>
				{#if env.thePosterDbUsername}<p class="mt-1 text-xs text-amber-400">
						{m.settings_set_from_env()}
					</p>{/if}
			</div>
			<div>
				<label for="thePosterDbPassword" class="mb-1 block text-sm font-medium"
					>{m.settings_theposterdb_password()}</label
				>
				<input
					id="thePosterDbPassword"
					type="password"
					autocomplete="off"
					bind:value={thePosterDbPassword}
					disabled={env.thePosterDbPassword}
					placeholder={thePosterDbPasswordSet
						? m.settings_secret_placeholder_set()
						: m.settings_theposterdb_password_placeholder_unset()}
					class="input w-full disabled:opacity-50"
				/>
				{#if env.thePosterDbPassword}<p class="mt-1 text-xs text-amber-400">
						{m.settings_set_from_env()}
					</p>{/if}
			</div>
		</div>
	{/if}
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

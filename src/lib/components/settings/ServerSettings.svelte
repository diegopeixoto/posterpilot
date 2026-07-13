<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import EmbyLogin from '$lib/components/EmbyLogin.svelte';
	import PlexLogin from '$lib/components/PlexLogin.svelte';
	import { m } from '$lib/paraglide/messages';
	import ServerManager from './ServerManager.svelte';

	type Section = { key: string; title: string; type: string };

	let {
		initial,
		locale,
		env,
		sections,
		selectedSections,
		refreshingLibs,
		libsError,
		onRefreshLibraries,
		onToggleSection,
		onLogin,
		serverType = $bindable(),
		plexUrl = $bindable(),
		plexToken = $bindable(),
		plexTokenSet = $bindable(),
		jellyfinUrl = $bindable(),
		jellyfinApiKey = $bindable(),
		jellyfinApiKeySet = $bindable(),
		embyUrl = $bindable(),
		embyApiKey = $bindable(),
		embyApiKeySet = $bindable(),
		manualOpen = $bindable()
	}: {
		initial: ComponentProps<typeof ServerManager>['initial'];
		locale: string;
		env: Record<string, boolean>;
		sections: Section[];
		selectedSections: Set<string>;
		refreshingLibs: boolean;
		libsError: string | null;
		onRefreshLibraries: () => void;
		onToggleSection: (key: string) => void;
		onLogin: () => void | Promise<void>;
		serverType: 'plex' | 'jellyfin' | 'emby';
		plexUrl: string;
		plexToken: string;
		plexTokenSet: boolean;
		jellyfinUrl: string;
		jellyfinApiKey: string;
		jellyfinApiKeySet: boolean;
		embyUrl: string;
		embyApiKey: string;
		embyApiKeySet: boolean;
		manualOpen: boolean;
	} = $props();
</script>

<ServerManager {initial} {locale} />

<div class="border-t border-neutral-800 pt-5">
	<h2 class="text-sm font-semibold">{m.server_manager_legacy_settings()}</h2>
	<p class="mt-1 text-xs text-neutral-400">{m.server_manager_legacy_settings_hint()}</p>
</div>

<div>
	<label for="serverType" class="mb-1 block text-sm font-medium">{m.settings_media_server()}</label>
	<select id="serverType" bind:value={serverType} disabled={env.serverType} class="input">
		<option value="plex">Plex</option>
		<option value="jellyfin">Jellyfin</option>
		<option value="emby">Emby</option>
	</select>
	{#if env.serverType}<p class="mt-1 text-xs text-amber-400">{m.settings_set_from_env()}</p>{/if}
</div>

{#if serverType === 'plex'}
	<div class="surface space-y-4 p-4">
		<PlexLogin bind:plexUrl bind:plexTokenSet {onLogin} />

		<details bind:open={manualOpen} class="border-t border-neutral-800 pt-3">
			<summary class="cursor-pointer text-sm text-neutral-400 hover:text-neutral-200">
				{m.settings_advanced_manual()}
			</summary>
			<div class="mt-3">
				<label for="plexToken" class="mb-1 block text-sm font-medium">
					{m.settings_plex_token_manual()}
				</label>
				<input
					id="plexToken"
					type="password"
					bind:value={plexToken}
					disabled={env.plexToken}
					placeholder={plexTokenSet
						? m.settings_plex_token_placeholder_set()
						: m.settings_plex_token_placeholder_unset()}
					class="input w-full disabled:opacity-50"
				/>
				{#if env.plexToken}<p class="mt-1 text-xs text-amber-400">
						{m.settings_set_from_env()}
					</p>{/if}
			</div>
		</details>
	</div>
{:else if serverType === 'jellyfin'}
	<div class="surface space-y-4 p-4">
		<EmbyLogin
			flavor="jellyfin"
			bind:serverUrl={jellyfinUrl}
			bind:apiKeySet={jellyfinApiKeySet}
			{onLogin}
		/>

		<details bind:open={manualOpen} class="border-t border-neutral-800 pt-3">
			<summary class="cursor-pointer text-sm text-neutral-400 hover:text-neutral-200">
				{m.settings_advanced_manual()}
			</summary>
			<div class="mt-3 space-y-4">
				<div>
					<label for="jellyfinUrl" class="mb-1 block text-sm font-medium">
						{m.settings_jellyfin_url()}
					</label>
					<input
						id="jellyfinUrl"
						bind:value={jellyfinUrl}
						disabled={env.jellyfinUrl}
						placeholder="http://192.168.1.10:8096"
						class="input w-full disabled:opacity-50"
					/>
					{#if env.jellyfinUrl}<p class="mt-1 text-xs text-amber-400">
							{m.settings_set_from_env()}
						</p>{/if}
				</div>
				<div>
					<label for="jellyfinApiKey" class="mb-1 block text-sm font-medium">
						{m.settings_jellyfin_api_key()}
					</label>
					<input
						id="jellyfinApiKey"
						type="password"
						bind:value={jellyfinApiKey}
						disabled={env.jellyfinApiKey}
						placeholder={jellyfinApiKeySet
							? m.settings_secret_placeholder_set()
							: m.settings_jellyfin_api_key_placeholder_unset()}
						class="input w-full disabled:opacity-50"
					/>
					{#if env.jellyfinApiKey}<p class="mt-1 text-xs text-amber-400">
							{m.settings_set_from_env()}
						</p>{/if}
				</div>
			</div>
		</details>
	</div>
{:else}
	<div class="surface space-y-4 p-4">
		<EmbyLogin flavor="emby" bind:serverUrl={embyUrl} bind:apiKeySet={embyApiKeySet} {onLogin} />

		<details bind:open={manualOpen} class="border-t border-neutral-800 pt-3">
			<summary class="cursor-pointer text-sm text-neutral-400 hover:text-neutral-200">
				{m.settings_advanced_manual()}
			</summary>
			<div class="mt-3 space-y-4">
				<div>
					<label for="embyUrl" class="mb-1 block text-sm font-medium">
						{m.settings_emby_url()}
					</label>
					<input
						id="embyUrl"
						bind:value={embyUrl}
						disabled={env.embyUrl}
						placeholder="http://192.168.1.10:8096"
						class="input w-full disabled:opacity-50"
					/>
					{#if env.embyUrl}<p class="mt-1 text-xs text-amber-400">
							{m.settings_set_from_env()}
						</p>{/if}
				</div>
				<div>
					<label for="embyApiKey" class="mb-1 block text-sm font-medium">
						{m.settings_emby_api_key()}
					</label>
					<input
						id="embyApiKey"
						type="password"
						bind:value={embyApiKey}
						disabled={env.embyApiKey}
						placeholder={embyApiKeySet
							? m.settings_secret_placeholder_set()
							: m.settings_emby_api_key_placeholder_unset()}
						class="input w-full disabled:opacity-50"
					/>
					{#if env.embyApiKey}<p class="mt-1 text-xs text-amber-400">
							{m.settings_set_from_env()}
						</p>{/if}
				</div>
			</div>
		</details>
	</div>
{/if}

<div>
	<div class="mb-1 flex items-center gap-2">
		<span class="text-sm font-medium">{m.settings_libraries_to_sync()}</span>
		<button
			type="button"
			onclick={onRefreshLibraries}
			disabled={refreshingLibs}
			class="btn btn-ghost px-2 py-0.5 text-xs"
		>
			{refreshingLibs ? m.settings_libraries_refreshing() : m.settings_libraries_refresh()}
		</button>
	</div>
	{#if libsError}
		<p class="mb-2 text-xs text-amber-400" role="alert">
			{m.settings_libraries_refresh_failed({ error: libsError })}
		</p>
	{/if}
	{#if sections.length === 0}
		<p class="text-xs text-neutral-400">{m.settings_libraries_connect_first()}</p>
	{:else}
		<p class="mb-2 text-xs text-neutral-400">{m.settings_libraries_hint()}</p>
		<div class="space-y-1">
			{#each sections as section (section.key)}
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input
						type="checkbox"
						checked={selectedSections.has(section.key)}
						onchange={() => onToggleSection(section.key)}
					/>
					{section.title}
					<span class="text-xs text-neutral-400">
						({section.type === 'movie' ? m.manual_match_type_movie() : m.manual_match_type_show()})
					</span>
				</label>
			{/each}
		</div>
	{/if}
</div>

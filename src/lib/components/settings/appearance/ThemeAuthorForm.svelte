<script lang="ts">
	/**
	 * Metadata form for authoring a custom theme. Owns its own fields and hands
	 * the parent a finished payload — the parent already tracks the appearance
	 * state that becomes the theme's tokens, and has no use for a half-typed name.
	 */
	import { m } from '$lib/paraglide/messages';

	export interface ThemeAuthorPayload {
		name: string;
		author?: string;
		url?: string;
		version?: string;
		description?: string;
		includeCustomCss: boolean;
	}

	let {
		baseThemeName,
		canBundleCss,
		busy,
		onSave,
		onCancel
	}: {
		baseThemeName: string;
		/** Whether there is any custom CSS to offer bundling in the first place. */
		canBundleCss: boolean;
		busy: boolean;
		onSave: (payload: ThemeAuthorPayload) => void;
		onCancel: () => void;
	} = $props();

	let name = $state('');
	let author = $state('');
	let url = $state('');
	let version = $state('');
	let description = $state('');
	let includeCustomCss = $state(false);

	function save() {
		if (!name.trim() || busy) return;
		onSave({
			name: name.trim(),
			author: author.trim() || undefined,
			url: url.trim() || undefined,
			version: version.trim() || undefined,
			description: description.trim() || undefined,
			includeCustomCss
		});
	}
</script>

<div class="surface space-y-3 p-4">
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="text-sm">
			<span class="mb-1 block font-medium">{m.appearance_theme_name()} *</span>
			<input type="text" bind:value={name} maxlength="60" class="input w-full" />
		</label>
		<label class="text-sm">
			<span class="mb-1 block font-medium">{m.appearance_theme_author()}</span>
			<input type="text" bind:value={author} maxlength="200" class="input w-full" />
		</label>
		<label class="text-sm">
			<span class="mb-1 block font-medium">{m.appearance_theme_url()}</span>
			<input
				type="url"
				bind:value={url}
				maxlength="500"
				placeholder="https://…"
				class="input w-full"
			/>
		</label>
		<label class="text-sm">
			<span class="mb-1 block font-medium">{m.appearance_theme_version()}</span>
			<input
				type="text"
				bind:value={version}
				maxlength="40"
				placeholder="1.0.0"
				class="input w-full"
			/>
		</label>
	</div>
	<label class="block text-sm">
		<span class="mb-1 block font-medium">{m.appearance_theme_description()}</span>
		<textarea bind:value={description} maxlength="500" rows="2" class="input w-full"></textarea>
	</label>
	{#if canBundleCss}
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={includeCustomCss} class="accent-accent-500" />
			{m.appearance_include_custom_css()}
		</label>
	{/if}
	<p class="text-xs text-text-faint">{m.appearance_based_on({ base: baseThemeName })}</p>
	<div class="flex gap-2">
		<button type="button" class="btn btn-accent" disabled={!name.trim() || busy} onclick={save}>
			{m.settings_save()}
		</button>
		<button type="button" class="btn btn-ghost" onclick={onCancel}>
			{m.server_manager_cancel()}
		</button>
	</div>
</div>

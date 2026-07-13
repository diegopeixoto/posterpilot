<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { setLocale } from '$lib/paraglide/runtime';
	import { toasts } from '$lib/stores/toasts.svelte';

	let {
		initialLocale,
		availableLocales
	}: {
		initialLocale: string;
		availableLocales: { code: string; name: string }[];
	} = $props();

	let language = $state(untrack(() => initialLocale));
	let switching = $state(false);

	async function changeLanguage(event: Event) {
		const next = (event.currentTarget as HTMLSelectElement).value;
		if (next === language || switching) return;
		const previous = language;
		language = next;
		switching = true;
		try {
			await setLocale(next as Parameters<typeof setLocale>[0]);
		} catch {
			language = previous;
			switching = false;
			toasts.error(m.settings_language_change_failed());
		}
	}
</script>

<div>
	<label for="language" class="mb-1 block text-sm font-medium">{m.settings_language()}</label>
	<div class="flex items-center gap-2">
		<select
			id="language"
			value={language}
			onchange={changeLanguage}
			disabled={switching}
			aria-busy={switching}
			class="input disabled:opacity-60"
		>
			{#each availableLocales as locale (locale.code)}
				<option value={locale.code}>{locale.name}</option>
			{/each}
		</select>
		{#if switching}
			<svg
				class="size-4 animate-spin text-accent-400 motion-reduce:animate-none"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
				<path
					class="opacity-90"
					fill="currentColor"
					d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
				/>
			</svg>
			<span class="sr-only" role="status">{m.settings_language_switching()}</span>
		{/if}
	</div>
</div>

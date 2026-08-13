<script lang="ts">
	/**
	 * The CSS a custom theme ships, shown and editable in its own field.
	 *
	 * It deliberately does not share the instance "Custom CSS" box below it. That
	 * one persists to the instance and applies under every theme, so folding a
	 * theme's CSS into it would copy someone else's rules into the user's own
	 * settings the moment they previewed the theme. Keeping them apart is also
	 * what makes an imported theme's CSS *readable* — before this it applied
	 * unseen.
	 */
	import { m } from '$lib/paraglide/messages';
	import { isValidThemeCss } from '$lib/theming/theme-file';

	let {
		themeName,
		value = $bindable(),
		onCommit
	}: {
		themeName: string;
		value: string;
		/** Persist to the theme (not the instance) when editing settles. */
		onCommit: () => void;
	} = $props();

	// Mirrors the server's rule so the reason shows up while typing rather than
	// as a failed save.
	const invalid = $derived(value.trim().length > 0 && !isValidThemeCss(value));
</script>

<div class="surface space-y-2 p-4">
	<label for="appearance-theme-css" class="text-sm font-medium">{m.appearance_theme_css()}</label>
	<textarea
		id="appearance-theme-css"
		bind:value
		onchange={onCommit}
		rows="5"
		spellcheck="false"
		aria-invalid={invalid}
		aria-describedby="appearance-theme-css-hint"
		class="input w-full font-mono text-xs {invalid ? 'border-red-500' : ''}"></textarea>
	{#if invalid}
		<p class="text-xs text-red-300" role="alert">{m.appearance_theme_css_invalid()}</p>
	{/if}
	<p id="appearance-theme-css-hint" class="text-xs text-text-faint">
		{m.appearance_theme_css_hint({ name: themeName })}
	</p>
</div>

<script lang="ts">
	/**
	 * The override controls, gated by the active theme's capability flags. A theme
	 * that locks a property renders no control at all for it — the lock is the
	 * theme's identity, not a disabled state to explain.
	 */
	import { m } from '$lib/paraglide/messages';
	import type { CustomizableFlags, CustomTheme, Theme } from '$lib/theming/schema';

	let {
		flags,
		baseTheme,
		activeCustom,
		accent = $bindable(),
		background = $bindable(),
		backgroundImage = $bindable(),
		backgroundImageDim = $bindable(),
		radius = $bindable(),
		onPreview,
		onAccentChange,
		onBackgroundChange,
		onBackgroundImageChange,
		onRadiusChange
	}: {
		flags: CustomizableFlags;
		baseTheme: Theme;
		activeCustom: CustomTheme | null;
		accent: string;
		background: string;
		backgroundImage: string;
		backgroundImageDim: number;
		radius: string;
		onPreview: () => void;
		onAccentChange: () => void;
		onBackgroundChange: () => void;
		onBackgroundImageChange: () => void;
		onRadiusChange: () => void;
	} = $props();

	// Classic phosphor palettes for the Terminal theme (its only customization).
	const TERMINAL_ACCENTS = ['#33ff33', '#ffb000', '#e8e8e8'];
	const RADIUS_OPTIONS = ['0', '0.25rem', '0.5rem', '0.75rem', '1rem'];

	const isTerminal = $derived(baseTheme.id === 'terminal');
	const anyControl = $derived(
		flags.accent || flags.background || flags.backgroundImage || flags.radius
	);
</script>

{#if anyControl}
	<div class="surface space-y-4 p-4">
		{#if flags.accent}
			<div class="flex items-center justify-between gap-3">
				<label for="appearance-accent" class="text-sm font-medium">{m.appearance_accent()}</label>
				<div class="flex items-center gap-2">
					{#if isTerminal}
						{#each TERMINAL_ACCENTS as phosphor (phosphor)}
							<button
								type="button"
								aria-label={phosphor}
								aria-pressed={accent === phosphor}
								onclick={() => {
									accent = phosphor;
									onAccentChange();
								}}
								class="size-6 rounded-full border {accent === phosphor
									? 'border-white ring-1 ring-white'
									: 'border-black/30'}"
								style="background-color: {phosphor}"
							></button>
						{/each}
					{:else}
						<input
							id="appearance-accent"
							type="color"
							value={accent || activeCustom?.tokens['accent-base'] || baseTheme.swatches[2]}
							oninput={(event) => {
								accent = event.currentTarget.value;
								onPreview();
							}}
							onchange={onAccentChange}
							class="h-7 w-10 cursor-pointer rounded border border-border-strong bg-transparent"
						/>
					{/if}
					{#if accent}
						<button
							type="button"
							class="btn btn-ghost px-2 py-1 text-xs"
							onclick={() => {
								accent = '';
								onAccentChange();
							}}>{m.appearance_reset()}</button
						>
					{/if}
				</div>
			</div>
		{/if}

		{#if flags.background}
			<div class="flex items-center justify-between gap-3">
				<label for="appearance-background" class="text-sm font-medium"
					>{m.appearance_background()}</label
				>
				<div class="flex items-center gap-2">
					<input
						id="appearance-background"
						type="color"
						value={background || baseTheme.swatches[0]}
						oninput={(event) => {
							background = event.currentTarget.value;
							onPreview();
						}}
						onchange={onBackgroundChange}
						class="h-7 w-10 cursor-pointer rounded border border-border-strong bg-transparent"
					/>
					{#if background}
						<button
							type="button"
							class="btn btn-ghost px-2 py-1 text-xs"
							onclick={() => {
								background = '';
								onBackgroundChange();
							}}>{m.appearance_reset()}</button
						>
					{/if}
				</div>
			</div>
		{/if}

		{#if flags.backgroundImage}
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-3">
					<label for="appearance-bg-image" class="text-sm font-medium"
						>{m.appearance_background_image()}</label
					>
					{#if backgroundImage}
						<button
							type="button"
							class="btn btn-ghost px-2 py-1 text-xs"
							onclick={() => {
								backgroundImage = '';
								onBackgroundImageChange();
							}}>{m.appearance_reset()}</button
						>
					{/if}
				</div>
				<input
					id="appearance-bg-image"
					type="url"
					bind:value={backgroundImage}
					onchange={onBackgroundImageChange}
					placeholder="https://…"
					class="input w-full"
				/>
				{#if backgroundImage}
					<label class="flex items-center gap-3 text-sm text-text-muted">
						<span class="shrink-0">{m.appearance_background_image_dim()}</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							bind:value={backgroundImageDim}
							oninput={onPreview}
							onchange={onBackgroundImageChange}
							class="w-full accent-accent-500"
						/>
					</label>
				{/if}
			</div>
		{/if}

		{#if flags.radius}
			<div class="flex items-center justify-between gap-3">
				<label for="appearance-radius" class="text-sm font-medium">{m.appearance_radius()}</label>
				<div class="flex items-center gap-2">
					<select
						id="appearance-radius"
						bind:value={radius}
						onchange={onRadiusChange}
						class="input"
					>
						<option value="">{m.appearance_default()}</option>
						{#each RADIUS_OPTIONS as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</div>
			</div>
		{/if}
	</div>
{/if}

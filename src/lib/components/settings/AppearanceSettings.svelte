<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { BUILTIN_THEMES, findBuiltinTheme } from '$lib/theming/presets';
	import { resolveAppearance, type ResolvedAppearance } from '$lib/theming/resolve';
	import { applyAppearance } from '$lib/theming/apply.client';
	import { serializeThemeFile } from '$lib/theming/theme-file';
	import { DEFAULT_THEME_ID, type CustomTheme } from '$lib/theming/schema';

	// Mirrors $lib/server/appearance.ts (kept structural: $lib/server modules must
	// not be imported into client code).
	interface StoredAppearanceSettings {
		themeId: string;
		themeAccentOverride: string | null;
		themeBackgroundOverride: string | null;
		themeBackgroundImage: string | null;
		themeBackgroundImageDim: number | null;
		themeRadiusOverride: string | null;
		navPlacement: 'top' | 'left';
	}

	let {
		initial
	}: {
		initial: {
			settings: StoredAppearanceSettings;
			customThemes: CustomTheme[];
			resolved: ResolvedAppearance;
		};
	} = $props();

	const snapshot = untrack(() => initial);

	let themeId = $state(snapshot.settings.themeId);
	let accent = $state(snapshot.settings.themeAccentOverride ?? '');
	let background = $state(snapshot.settings.themeBackgroundOverride ?? '');
	let backgroundImage = $state(snapshot.settings.themeBackgroundImage ?? '');
	let backgroundImageDim = $state<number>(snapshot.settings.themeBackgroundImageDim ?? 0.6);
	let radius = $state(snapshot.settings.themeRadiusOverride ?? '');
	let navPlacement = $state<'top' | 'left'>(snapshot.settings.navPlacement);
	let customThemes = $state<CustomTheme[]>([...snapshot.customThemes]);

	const activeCustom = $derived(customThemes.find((theme) => theme.id === themeId) ?? null);
	const baseTheme = $derived(
		findBuiltinTheme(activeCustom?.base ?? themeId) ?? findBuiltinTheme(DEFAULT_THEME_ID)!
	);
	const flags = $derived(baseTheme.customizable);
	const isTerminal = $derived(baseTheme.id === 'terminal');

	const baseThemes = BUILTIN_THEMES.filter((theme) => theme.family === 'base');
	const extremeThemes = BUILTIN_THEMES.filter((theme) => theme.family === 'extreme');
	const themeGroups = [
		{ key: 'base', themes: baseThemes },
		{ key: 'extreme', themes: extremeThemes }
	];

	// Classic phosphor palettes for the Terminal theme (its only customization).
	const TERMINAL_ACCENTS = ['#33ff33', '#ffb000', '#e8e8e8'];
	const RADIUS_OPTIONS = ['0', '0.25rem', '0.5rem', '0.75rem', '1rem'];

	function currentResolution() {
		return resolveAppearance(
			{
				themeId,
				accentOverride: accent || null,
				backgroundOverride: background || null,
				backgroundImage: backgroundImage || null,
				backgroundImageDim,
				radiusOverride: radius || null
			},
			customThemes
		);
	}

	/** Instant client-side preview; persistence happens on change end. */
	function preview() {
		applyAppearance(currentResolution());
	}

	async function persist(patch: Record<string, unknown>) {
		const response = await fetch('/api/appearance', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!response.ok) throw new Error(`persist failed (${response.status})`);
	}

	async function applyAndPersist(patch: Record<string, unknown>, reload = false) {
		preview();
		try {
			await persist(patch);
			// Nav placement restructures the root layout; like the locale strategy,
			// persist then reload so the next SSR pass renders the new placement.
			if (reload) window.location.reload();
		} catch {
			toasts.error(m.settings_save_failed());
		}
	}

	function selectTheme(id: string) {
		if (id === themeId) return;
		themeId = id;
		void applyAndPersist({ themeId: id });
	}

	function onAccentChange() {
		void applyAndPersist({ themeAccentOverride: accent || null });
	}

	function onBackgroundChange() {
		void applyAndPersist({ themeBackgroundOverride: background || null });
	}

	function onBackgroundImageChange() {
		void applyAndPersist({
			themeBackgroundImage: backgroundImage || null,
			themeBackgroundImageDim: backgroundImageDim
		});
	}

	function onRadiusChange() {
		void applyAndPersist({ themeRadiusOverride: radius || null });
	}

	function onNavPlacementChange(placement: 'top' | 'left') {
		if (placement === navPlacement) return;
		navPlacement = placement;
		void applyAndPersist({ navPlacement: placement }, true);
	}

	// ── Custom theme authoring ────────────────────────────────────────────────

	let authorOpen = $state(false);
	let authorName = $state('');
	let authorAuthor = $state('');
	let authorUrl = $state('');
	let authorVersion = $state('');
	let authorDescription = $state('');
	let authorBusy = $state(false);

	/** The deltas an authored theme captures: the currently accepted overrides. */
	function capturedTokens(): CustomTheme['tokens'] {
		const tokens: CustomTheme['tokens'] = {};
		if (flags.accent && accent) tokens['accent-base'] = accent;
		if (flags.background && background) tokens.background = background;
		if (flags.radius && radius) tokens.radius = radius;
		return tokens;
	}

	async function saveTheme() {
		if (!authorName.trim() || authorBusy) return;
		authorBusy = true;
		try {
			const response = await fetch('/api/appearance/themes', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: authorName.trim(),
					author: authorAuthor.trim() || undefined,
					url: authorUrl.trim() || undefined,
					version: authorVersion.trim() || undefined,
					description: authorDescription.trim() || undefined,
					base: baseTheme.id,
					tokens: capturedTokens()
				})
			});
			if (!response.ok) throw new Error(String(response.status));
			const body = (await response.json()) as { themes: CustomTheme[]; theme: CustomTheme };
			customThemes = body.themes;
			themeId = body.theme.id;
			authorOpen = false;
			authorName = authorAuthor = authorUrl = authorVersion = authorDescription = '';
			toasts.success(m.appearance_theme_saved({ name: body.theme.name }));
			preview();
		} catch {
			toasts.error(m.settings_save_failed());
		} finally {
			authorBusy = false;
		}
	}

	async function updateTheme() {
		if (!activeCustom || authorBusy) return;
		authorBusy = true;
		try {
			const response = await fetch('/api/appearance/themes', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...activeCustom, tokens: capturedTokens() })
			});
			if (!response.ok) throw new Error(String(response.status));
			const body = (await response.json()) as { themes: CustomTheme[]; theme: CustomTheme };
			customThemes = body.themes;
			toasts.success(m.appearance_theme_saved({ name: body.theme.name }));
			preview();
		} catch {
			toasts.error(m.settings_save_failed());
		} finally {
			authorBusy = false;
		}
	}

	async function deleteTheme() {
		if (!activeCustom) return;
		const deleted = activeCustom;
		try {
			const response = await fetch(`/api/appearance/themes?id=${encodeURIComponent(deleted.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error(String(response.status));
			const body = (await response.json()) as { themes: CustomTheme[] };
			customThemes = body.themes;
			// The server falls back to the base when the active theme is deleted.
			if (themeId === deleted.id) themeId = deleted.base;
			toasts.success(m.appearance_theme_deleted());
			preview();
		} catch {
			toasts.error(m.settings_save_failed());
		}
	}

	function exportTheme(theme: CustomTheme) {
		const blob = new Blob([serializeThemeFile(theme)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${theme.id.replace(/^custom:/, '')}.posterpilot-theme.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	let importInput = $state<HTMLInputElement | null>(null);
	async function importTheme(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const text = await file.text();
		try {
			const response = await fetch('/api/appearance/themes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ file: text })
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: { code?: string };
				} | null;
				const code = body?.error?.code;
				throw new Error(code ?? 'invalid');
			}
			const body = (await response.json()) as { themes: CustomTheme[]; theme: CustomTheme };
			customThemes = body.themes;
			themeId = body.theme.id;
			toasts.success(m.appearance_imported({ name: body.theme.name }));
			preview();
		} catch (error) {
			const code = error instanceof Error ? error.message : '';
			toasts.error(
				code === 'unsupported_version'
					? m.appearance_import_unsupported_version()
					: code === 'too_large'
						? m.appearance_import_too_large()
						: code === 'too_many_themes'
							? m.appearance_too_many()
							: m.appearance_import_invalid()
			);
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="section-title">{m.appearance_title()}</h2>
		<p class="text-sm text-text-muted">{m.appearance_description()}</p>
	</div>

	<!-- Theme picker -->
	<div class="space-y-4">
		{#each themeGroups as group (group.key)}
			<div>
				<h3 class="mb-2 text-xs font-semibold tracking-wide text-text-faint uppercase">
					{group.key === 'base' ? m.appearance_themes_base() : m.appearance_themes_extreme()}
				</h3>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each group.themes as theme (theme.id)}
						<button
							type="button"
							onclick={() => selectTheme(theme.id)}
							aria-pressed={themeId === theme.id}
							class="surface flex flex-col gap-2 p-3 text-left transition hover:border-border-hover {themeId ===
							theme.id
								? 'border-accent-500 ring-1 ring-accent-500'
								: ''}"
						>
							<span class="flex gap-1.5" aria-hidden="true">
								{#each theme.swatches as swatch (swatch)}
									<span
										class="size-5 rounded-full border border-black/30"
										style="background-color: {swatch}"
									></span>
								{/each}
							</span>
							<span class="text-xs font-medium">{theme.name}</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}

		{#if customThemes.length > 0}
			<div>
				<h3 class="mb-2 text-xs font-semibold tracking-wide text-text-faint uppercase">
					{m.appearance_themes_custom()}
				</h3>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each customThemes as theme (theme.id)}
						{@const base = findBuiltinTheme(theme.base)}
						<div
							class="surface flex flex-col gap-2 p-3 {themeId === theme.id
								? 'border-accent-500 ring-1 ring-accent-500'
								: ''}"
						>
							<button
								type="button"
								onclick={() => selectTheme(theme.id)}
								aria-pressed={themeId === theme.id}
								class="flex flex-col gap-2 text-left"
							>
								<span class="flex gap-1.5" aria-hidden="true">
									{#each base?.swatches ?? [] as swatch (swatch)}
										<span
											class="size-5 rounded-full border border-black/30"
											style="background-color: {theme.tokens['accent-base'] &&
											swatch === base?.swatches[2]
												? theme.tokens['accent-base']
												: swatch}"
										></span>
									{/each}
								</span>
								<span class="text-xs font-medium">{theme.name}</span>
								<span class="text-[10px] text-text-faint">
									{m.appearance_based_on({ base: base?.name ?? theme.base })}
									{theme.version ? ` · v${theme.version}` : ''}
								</span>
							</button>
							<span class="flex gap-1">
								<button
									type="button"
									class="btn btn-ghost px-2 py-0.5 text-[10px]"
									onclick={() => exportTheme(theme)}>{m.appearance_export()}</button
								>
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- Overrides, gated by the active theme's capability flags -->
	{#if flags.accent || flags.background || flags.backgroundImage || flags.radius}
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
								value={accent || baseTheme.swatches[2]}
								oninput={(event) => {
									accent = event.currentTarget.value;
									preview();
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
								preview();
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
								oninput={preview}
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

	<!-- Navigation placement -->
	<div class="surface flex items-center justify-between gap-3 p-4">
		<span class="text-sm font-medium">{m.appearance_nav_placement()}</span>
		<div class="flex gap-2" role="radiogroup" aria-label={m.appearance_nav_placement()}>
			{#each ['top', 'left'] as placement (placement)}
				<button
					type="button"
					role="radio"
					aria-checked={navPlacement === placement}
					onclick={() => onNavPlacementChange(placement as 'top' | 'left')}
					class="chip {navPlacement === placement ? 'chip-active' : ''}"
				>
					{placement === 'top' ? m.appearance_nav_top() : m.appearance_nav_left()}
				</button>
			{/each}
		</div>
	</div>

	<!-- Authoring + import -->
	<div class="flex flex-wrap items-center gap-2">
		<button type="button" class="btn btn-subtle" onclick={() => (authorOpen = !authorOpen)}>
			{m.appearance_save_as_theme()}
		</button>
		{#if activeCustom}
			<button type="button" class="btn btn-subtle" disabled={authorBusy} onclick={updateTheme}>
				{m.appearance_update_theme()}
			</button>
			<button type="button" class="btn btn-ghost" onclick={deleteTheme}>
				{m.appearance_delete_theme()}
			</button>
		{/if}
		<button type="button" class="btn btn-ghost" onclick={() => importInput?.click()}>
			{m.appearance_import()}
		</button>
		<input
			bind:this={importInput}
			type="file"
			accept=".json,application/json"
			class="hidden"
			onchange={importTheme}
		/>
	</div>

	{#if authorOpen}
		<div class="surface space-y-3 p-4">
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="text-sm">
					<span class="mb-1 block font-medium">{m.appearance_theme_name()} *</span>
					<input type="text" bind:value={authorName} maxlength="60" class="input w-full" />
				</label>
				<label class="text-sm">
					<span class="mb-1 block font-medium">{m.appearance_theme_author()}</span>
					<input type="text" bind:value={authorAuthor} maxlength="200" class="input w-full" />
				</label>
				<label class="text-sm">
					<span class="mb-1 block font-medium">{m.appearance_theme_url()}</span>
					<input
						type="url"
						bind:value={authorUrl}
						maxlength="500"
						placeholder="https://…"
						class="input w-full"
					/>
				</label>
				<label class="text-sm">
					<span class="mb-1 block font-medium">{m.appearance_theme_version()}</span>
					<input
						type="text"
						bind:value={authorVersion}
						maxlength="40"
						placeholder="1.0.0"
						class="input w-full"
					/>
				</label>
			</div>
			<label class="block text-sm">
				<span class="mb-1 block font-medium">{m.appearance_theme_description()}</span>
				<textarea bind:value={authorDescription} maxlength="500" rows="2" class="input w-full"
				></textarea>
			</label>
			<p class="text-xs text-text-faint">
				{m.appearance_based_on({ base: baseTheme.name })}
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					class="btn btn-accent"
					disabled={!authorName.trim() || authorBusy}
					onclick={saveTheme}
				>
					{m.settings_save()}
				</button>
				<button type="button" class="btn btn-ghost" onclick={() => (authorOpen = false)}>
					{m.server_manager_cancel()}
				</button>
			</div>
		</div>
	{/if}
</div>

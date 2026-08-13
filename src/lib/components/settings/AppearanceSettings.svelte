<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { chrome } from '$lib/stores/chrome.svelte';
	import { findBuiltinTheme } from '$lib/theming/presets';
	import ThemePicker from './appearance/ThemePicker.svelte';
	import ThemeOverrides from './appearance/ThemeOverrides.svelte';
	import NavPlacementField from './appearance/NavPlacementField.svelte';
	import ThemeAuthorForm, { type ThemeAuthorPayload } from './appearance/ThemeAuthorForm.svelte';
	import ThemeCssField from './appearance/ThemeCssField.svelte';
	import { resolveAppearance, type ResolvedAppearance } from '$lib/theming/resolve';
	import { applyAppearance } from '$lib/theming/apply.client';
	import { captureThemeCss, captureThemeTokens } from '$lib/theming/authoring';
	import {
		MAX_THEME_FILE_BYTES,
		parseThemeFile,
		serializeThemeFile
	} from '$lib/theming/theme-file';
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
		customCss: string | null;
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
	let customCss = $state(snapshot.settings.customCss ?? '');
	let customThemes = $state<CustomTheme[]>([...snapshot.customThemes]);

	const activeCustom = $derived(customThemes.find((theme) => theme.id === themeId) ?? null);
	const baseTheme = $derived(
		findBuiltinTheme(activeCustom?.base ?? themeId) ?? findBuiltinTheme(DEFAULT_THEME_ID)!
	);
	const flags = $derived(baseTheme.customizable);
	// An extreme theme that reskins the chrome forces its own layout, so the
	// nav-placement control must show that rather than accept a click it will
	// silently ignore (`resolveAppearance` discards the setting either way).
	const navLocked = $derived(Boolean(baseTheme.layout));
	const effectiveNav = $derived<'top' | 'left'>(
		baseTheme.layout === 'sidebar' ? 'left' : navPlacement
	);

	function currentResolution() {
		return resolveAppearance(
			{
				themeId,
				accentOverride: accent || null,
				backgroundOverride: background || null,
				backgroundImage: backgroundImage || null,
				backgroundImageDim,
				radiusOverride: radius || null,
				// Without this the resolver defaults to `top`, and since `preview()`
				// now drives the live chrome, tweaking an accent would yank a
				// left-sidebar layout back to a top bar until the next reload.
				navPlacement
			},
			customThemes
		);
	}

	/** Instant client-side preview; persistence happens on change end.
	 *  The chrome layout goes through the shared store rather than waiting for
	 *  the next server render — picking Overseerr used to repaint the colors at
	 *  once and leave the nav in the old arrangement until a reload. */
	function preview() {
		const resolved = currentResolution();
		applyAppearance(resolved);
		chrome.setNavPlacement(resolved.navPlacement);
	}

	async function persist(patch: Record<string, unknown>) {
		const response = await fetch('/api/appearance', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!response.ok) throw new Error(`persist failed (${response.status})`);
	}

	async function applyAndPersist(patch: Record<string, unknown>) {
		preview();
		try {
			await persist(patch);
		} catch {
			toasts.error(m.settings_save_failed());
		}
	}

	function selectTheme(id: string) {
		if (id === themeId) return;
		themeId = id;
		void applyAndPersist({ themeId: id });
	}

	/** Make a freshly created or imported theme the active one. Saving the theme
	 *  list does not touch the appearance settings, so without this the UI showed
	 *  it as active while the next SSR pass rendered the previous theme. */
	function activateTheme(id: string) {
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
		void applyAndPersist({ navPlacement: placement });
	}

	/** Custom CSS: apply instantly by upserting the style element the SSR
	 *  injection renders, then persist on change end. */
	function previewCustomCss() {
		let el = document.getElementById('pp-custom-css');
		if (!customCss.trim()) {
			el?.remove();
			return;
		}
		if (!el) {
			el = document.createElement('style');
			el.id = 'pp-custom-css';
			document.head.appendChild(el);
		}
		el.textContent = customCss;
	}

	function onCustomCssChange() {
		previewCustomCss();
		void persist({ customCss: customCss.trim() ? customCss : null }).catch(() =>
			toasts.error(m.settings_save_failed())
		);
	}

	// ── Custom theme authoring ────────────────────────────────────────────────

	let authorOpen = $state(false);
	let authorBusy = $state(false);
	let confirmDelete = $state(false);

	// The active custom theme's own CSS, hydrated when the selection changes.
	// Keyed on the theme id rather than mirrored on every state change, so an
	// unsaved edit survives touching any other control.
	let themeCss = $state(untrack(() => activeCustom?.css ?? ''));
	let themeCssLoadedFor = $state<string | null>(untrack(() => activeCustom?.id ?? null));
	$effect(() => {
		const id = activeCustom?.id ?? null;
		if (id === themeCssLoadedFor) return;
		themeCssLoadedFor = id;
		themeCss = activeCustom?.css ?? '';
	});
	/** A parsed import held back for confirmation because it ships CSS. */
	let pendingImport = $state<{ file: string; name: string; kb: string } | null>(null);

	/** What "save as theme" writes — see `$lib/theming/authoring`. */
	function capturedTokens(): CustomTheme['tokens'] {
		return captureThemeTokens({
			baseTokens: activeCustom?.tokens ?? {},
			flags,
			accent,
			background,
			radius
		});
	}

	/** `includeCustomCss` is an authoring-form choice; updating an existing theme
	 *  has no such prompt, so it never folds instance CSS in — it only preserves
	 *  whatever the theme already ships. */
	function capturedCss(includeCustomCss = false): string | undefined {
		return captureThemeCss({ includeCustomCss, customCss, themeCss });
	}

	async function saveTheme(payload: ThemeAuthorPayload) {
		if (authorBusy) return;
		authorBusy = true;
		try {
			const { includeCustomCss, ...metadata } = payload;
			const response = await fetch('/api/appearance/themes', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...metadata,
					base: baseTheme.id,
					tokens: capturedTokens(),
					css: capturedCss(includeCustomCss)
				})
			});
			if (!response.ok) throw new Error(String(response.status));
			const body = (await response.json()) as { themes: CustomTheme[]; theme: CustomTheme };
			customThemes = body.themes;
			authorOpen = false;
			toasts.success(m.appearance_theme_saved({ name: body.theme.name }));
			activateTheme(body.theme.id);
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
				body: JSON.stringify({
					...activeCustom,
					tokens: capturedTokens(),
					css: capturedCss()
				})
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

	/** Deleting is irreversible and the export file is the only backup, so it
	 *  takes a second, explicit press. */
	async function deleteTheme() {
		if (!activeCustom) return;
		const deleted = activeCustom;
		confirmDelete = false;
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
		// Revoking in the same tick cancels the download in some browsers; give
		// the navigation a turn of the event loop first.
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	let importInput = $state<HTMLInputElement | null>(null);

	/**
	 * Read a theme file and decide whether it can be applied straight away.
	 *
	 * A theme file arrives from somebody else, and one that ships CSS gets to
	 * restyle every page — so that case is disclosed and confirmed instead of
	 * being applied the moment the file picker closes. Parsing here is for the
	 * disclosure only; the server validates the file independently.
	 */
	async function importTheme(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > MAX_THEME_FILE_BYTES) {
			toasts.error(m.appearance_import_too_large());
			return;
		}
		const text = await file.text();
		const parsed = parseThemeFile(text);
		if (!parsed.ok) {
			toasts.error(importErrorMessage(parsed.error));
			return;
		}
		if (parsed.theme.css) {
			const bytes = new TextEncoder().encode(parsed.theme.css).byteLength;
			pendingImport = {
				file: text,
				name: parsed.theme.name,
				kb: (bytes / 1024).toFixed(1)
			};
			return;
		}
		await sendImport(text);
	}

	function importErrorMessage(code: string): string {
		return code === 'unsupported_version'
			? m.appearance_import_unsupported_version()
			: code === 'too_large'
				? m.appearance_import_too_large()
				: code === 'too_many_themes'
					? m.appearance_too_many()
					: code === 'invalid_css'
						? m.appearance_import_invalid_css()
						: m.appearance_import_invalid();
	}

	async function sendImport(text: string) {
		pendingImport = null;
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
			toasts.success(m.appearance_imported({ name: body.theme.name }));
			activateTheme(body.theme.id);
		} catch (error) {
			toasts.error(importErrorMessage(error instanceof Error ? error.message : ''));
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="section-title">{m.appearance_title()}</h2>
		<p class="text-sm text-text-muted">{m.appearance_description()}</p>
	</div>

	<ThemePicker {themeId} {customThemes} onSelect={selectTheme} onExport={exportTheme} />

	<ThemeOverrides
		{flags}
		{baseTheme}
		{activeCustom}
		bind:accent
		bind:background
		bind:backgroundImage
		bind:backgroundImageDim
		bind:radius
		onPreview={preview}
		{onAccentChange}
		{onBackgroundChange}
		{onBackgroundImageChange}
		{onRadiusChange}
	/>

	<NavPlacementField
		effective={effectiveNav}
		locked={navLocked}
		lockedByTheme={baseTheme.name}
		onChange={onNavPlacementChange}
	/>

	<!-- The active theme's own CSS, so an imported theme's rules are readable and
	     a theme you own is editable. Persists to the theme, not the instance. -->
	{#if activeCustom}
		<ThemeCssField themeName={activeCustom.name} bind:value={themeCss} onCommit={updateTheme} />
	{/if}

	<!-- Custom CSS escape hatch (instance-wide, applies under every theme) -->
	<div class="surface space-y-2 p-4">
		<label for="appearance-custom-css" class="text-sm font-medium"
			>{m.appearance_custom_css()}</label
		>
		<textarea
			id="appearance-custom-css"
			bind:value={customCss}
			oninput={previewCustomCss}
			onchange={onCustomCssChange}
			rows="5"
			spellcheck="false"
			placeholder={'.surface { border-width: 2px }'}
			class="input w-full font-mono text-xs"></textarea>
		<p class="text-xs text-text-faint">{m.appearance_custom_css_hint()}</p>
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
			{#if confirmDelete}
				<button type="button" class="btn btn-ghost text-red-300" onclick={deleteTheme}>
					{m.appearance_delete_theme_confirm_action()}
				</button>
				<button type="button" class="btn btn-ghost" onclick={() => (confirmDelete = false)}>
					{m.appearance_cancel()}
				</button>
			{:else}
				<button type="button" class="btn btn-ghost" onclick={() => (confirmDelete = true)}>
					{m.appearance_delete_theme()}
				</button>
			{/if}
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

	{#if confirmDelete && activeCustom}
		<p class="text-sm text-amber-300" role="alert">
			{m.appearance_delete_theme_confirm({ name: activeCustom.name })}
		</p>
	{/if}

	<!-- A downloaded theme that ships CSS gets to restyle every page, so it is
	     disclosed and confirmed rather than applied on file pick. -->
	{#if pendingImport}
		<div class="surface space-y-3 p-4" role="alert">
			<p class="text-sm text-text-secondary">
				{m.appearance_import_ships_css({ name: pendingImport.name, kb: pendingImport.kb })}
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					class="btn btn-accent"
					onclick={() => pendingImport && sendImport(pendingImport.file)}
				>
					{m.appearance_import_confirm()}
				</button>
				<button type="button" class="btn btn-ghost" onclick={() => (pendingImport = null)}>
					{m.appearance_cancel()}
				</button>
			</div>
		</div>
	{/if}

	{#if authorOpen}
		<ThemeAuthorForm
			baseThemeName={baseTheme.name}
			canBundleCss={Boolean(customCss.trim())}
			busy={authorBusy}
			onSave={saveTheme}
			onCancel={() => (authorOpen = false)}
		/>
	{/if}
</div>

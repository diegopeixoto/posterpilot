<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages';
	import { setLocale } from '$lib/paraglide/runtime';
	import PlexLogin from '$lib/components/PlexLogin.svelte';

	let { data } = $props();
	const env = data.config.envManaged;

	// The library checklist: cached server libraries (rendered instantly) that a
	// Refresh button can re-fetch live without blocking the page.
	type Section = { key: string; title: string; type: string };
	let sections = $state<Section[]>(data.sections);
	const selectedSections = new SvelteSet<string>(
		data.config.includedSections.length
			? data.config.includedSections
			: data.sections.map((s) => s.key)
	);
	// All currently-known libraries selected → persist [] (sync everything, incl.
	// future libraries). Recomputed against the live `sections` list.
	const allSelected = $derived(
		sections.length > 0 && sections.every((s) => selectedSections.has(s.key))
	);
	function toggleSection(key: string) {
		if (selectedSections.has(key)) selectedSections.delete(key);
		else selectedSections.add(key);
	}

	let refreshingLibs = $state(false);
	let libsError = $state<string | null>(null);
	async function refreshLibraries() {
		refreshingLibs = true;
		libsError = null;
		try {
			const res = await fetch('/api/plex/sections');
			const body = (await res.json()) as { sections?: Section[]; error?: string };
			if (Array.isArray(body.sections)) {
				const wasAll = allSelected || selectedSections.size === 0;
				sections = body.sections;
				// If everything was selected, keep "select all" semantics across the
				// refreshed list (so a newly-added library defaults to synced).
				if (wasAll) {
					selectedSections.clear();
					for (const s of sections) selectedSections.add(s.key);
				}
			}
			if (body.error) libsError = body.error;
		} catch (e) {
			libsError = e instanceof Error ? e.message : String(e);
		} finally {
			refreshingLibs = false;
		}
	}

	// Auto-refresh once in the background so the cached list stays current.
	onMount(() => {
		refreshLibraries();
	});

	type Tab = 'server' | 'providers' | 'advanced' | 'kometa' | 'language' | 'activity';
	const TABS: Tab[] = ['server', 'providers', 'advanced', 'kometa', 'language', 'activity'];
	const initialTab = page.url.searchParams.get('tab');
	let tab = $state<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'server');
	const tabs: { key: Tab; label: () => string }[] = [
		{ key: 'server', label: m.settings_tab_server },
		{ key: 'providers', label: m.settings_tab_providers },
		{ key: 'advanced', label: m.settings_tab_advanced },
		{ key: 'kometa', label: m.settings_tab_kometa },
		{ key: 'language', label: m.settings_tab_language },
		{ key: 'activity', label: m.settings_tab_activity }
	];

	// ── Activity log (Events moved into this tab) ──────────────────────────────
	type LevelFilter = 'all' | 'info' | 'warn' | 'error';
	type EventRow = {
		id: number;
		level: string;
		type: string;
		message: string;
		createdAt: string | Date | null;
	};
	const levelFilters: { key: LevelFilter; label: () => string }[] = [
		{ key: 'all', label: m.events_level_all },
		{ key: 'info', label: m.events_level_info },
		{ key: 'warn', label: m.events_level_warn },
		{ key: 'error', label: m.events_level_error }
	];
	let events = $state<EventRow[]>(data.events as EventRow[]);
	let eventsCursor = $state<number | null>(data.eventsNextCursor);
	let eventLevel = $state<LevelFilter>('all');
	let eventsLoading = $state(false);

	const eventBadgeClass: Record<string, string> = {
		info: 'badge badge-info',
		warn: 'badge badge-warn',
		error: 'badge badge-error'
	};
	function fmtTime(ts: string | Date | null): string {
		return ts ? new Date(ts).toLocaleString(data.locale) : '—';
	}

	async function loadEvents(opts: { level?: LevelFilter; before?: number | null } = {}) {
		eventsLoading = true;
		try {
			const params = new URLSearchParams();
			const lvl = opts.level ?? eventLevel;
			if (lvl !== 'all') params.set('level', lvl);
			if (opts.before != null) params.set('before', String(opts.before));
			const res = await fetch(`/api/events?${params.toString()}`);
			const body = (await res.json()) as { events: EventRow[]; nextCursor: number | null };
			events = opts.before != null ? [...events, ...body.events] : body.events;
			eventsCursor = body.nextCursor;
		} finally {
			eventsLoading = false;
		}
	}

	function setEventLevel(level: LevelFilter) {
		if (level === eventLevel) return;
		eventLevel = level;
		loadEvents({ level, before: null });
	}

	let clearingEvents = $state(false);
	// Inline confirm: first click arms (button turns destructive + asks to confirm),
	// second click clears. Replaces the blocking native confirm() dialog.
	let confirmingClear = $state(false);
	async function clearEvents() {
		if (!confirmingClear) {
			confirmingClear = true;
			return;
		}
		confirmingClear = false;
		clearingEvents = true;
		try {
			await fetch('/api/events', { method: 'DELETE' });
			// Reload from the current filter so the freshly-cleared list reflects truth.
			await loadEvents({ before: null });
		} finally {
			clearingEvents = false;
		}
	}

	let serverType = $state<'plex' | 'jellyfin' | 'emby'>(data.config.serverType);

	// Plex
	let plexUrl = $state(data.config.plexUrl ?? '');
	let plexToken = $state('');
	let plexTokenSet = $state(data.config.plexTokenSet);

	// Jellyfin / Emby
	let jellyfinUrl = $state(data.config.jellyfinUrl ?? '');
	let jellyfinApiKey = $state('');
	let embyUrl = $state(data.config.embyUrl ?? '');
	let embyApiKey = $state('');

	let tmdbKey = $state('');
	let kometaAssetsDir = $state(data.config.kometaAssetsDir);
	let mediuxDelayMs = $state(String(data.config.mediuxDelayMs));
	let mediuxConcurrency = $state(String(data.config.mediuxConcurrency));
	let httpCacheTtlDays = $state(String(data.config.httpCacheTtlDays));
	let defaultApplyMethod = $state(data.config.defaultApplyMethod);
	// Preferred UI language — reflects the active locale and writes the same
	// `language` setting as the header switcher.
	let language = $state(data.locale);

	let providerMediux = $state(data.config.providerMediux);
	let providerTmdb = $state(data.config.providerTmdb);
	let providerFanart = $state(data.config.providerFanart);
	let providerThePosterDb = $state(data.config.providerThePosterDb);
	let fanartKey = $state('');

	// ── Kometa config-sync tab ─────────────────────────────────────────────────
	let kometaConfigPath = $state(data.config.kometaConfigPath);
	let kometaMetadataPath = $state(data.config.kometaMetadataPath);
	let kometaMode = $state<'merge' | 'own'>(data.config.kometaConfigMode);
	const kometaLibs = new SvelteSet<string>(data.kometa.managedLibraries);
	// Per-library enabled default sets, keyed by section key.
	const kometaDefaults = $state<Record<string, SvelteSet<string>>>(
		Object.fromEntries(
			Object.entries(data.kometa.defaultCollections).map(([k, v]) => [k, new SvelteSet(v)])
		)
	);
	// Pre-seed every managed-setting key so `bind:value` has a reactive slot.
	let kometaSettings = $state<Record<string, string>>(
		Object.fromEntries(
			data.kometa.managedSettingDefs.map((d) => [d.id, data.kometa.managedSettings[d.id] ?? ''])
		)
	);

	// i18n label lookups keyed by the catalog/def ids (m.* is a static object).
	const kometaGroupLabel: Record<string, () => string> = {
		content: m.kometa_group_content,
		production: m.kometa_group_production,
		location: m.kometa_group_location,
		time: m.kometa_group_time,
		media: m.kometa_group_media,
		content_rating: m.kometa_group_content_rating,
		people: m.kometa_group_people,
		award: m.kometa_group_award,
		chart: m.kometa_group_chart
	};
	const kometaSettingLabel: Record<string, () => string> = {
		asset_directory: m.kometa_setting_asset_directory,
		webhook_error: m.kometa_setting_webhook_error,
		webhook_run_start: m.kometa_setting_webhook_run_start,
		webhook_run_end: m.kometa_setting_webhook_run_end
	};

	function kometaToggleLib(key: string) {
		if (kometaLibs.has(key)) kometaLibs.delete(key);
		else kometaLibs.add(key);
	}
	function kometaDefaultsFor(key: string): SvelteSet<string> {
		if (!kometaDefaults[key]) kometaDefaults[key] = new SvelteSet<string>();
		return kometaDefaults[key];
	}
	function kometaToggleDefault(key: string, name: string) {
		const set = kometaDefaultsFor(key);
		if (set.has(name)) set.delete(name);
		else set.add(name);
	}

	type KometaChange = { op: string; path: string; before?: string | null; after?: string | null };
	type KometaResult = {
		active: boolean;
		mode: 'merge' | 'own';
		exists: boolean;
		willScaffold: boolean;
		parseError: string | null;
		changes: KometaChange[];
		warnings: string[];
		dropped: string[];
		backup?: boolean;
		scaffolded?: boolean;
	};

	let kometaBusy = $state(false);
	let kometaPreview = $state<KometaResult | null>(null);
	let kometaError = $state<string | null>(null);
	let kometaDone = $state<'synced' | 'created' | null>(null);

	function kometaSelection() {
		const libraries = [...kometaLibs];
		const defaults: Record<string, string[]> = {};
		for (const key of libraries) {
			const set = kometaDefaults[key];
			if (set && set.size) defaults[key] = [...set];
		}
		const settings: Record<string, string> = {};
		for (const def of data.kometa.managedSettingDefs) {
			const v = (kometaSettings[def.id] ?? '').trim();
			if (v) settings[def.id] = v;
		}
		return { libraries, defaults, settings };
	}

	async function kometaPost(path: string): Promise<KometaResult> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(kometaSelection())
		});
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as KometaResult;
	}

	async function kometaDoPreview() {
		if (kometaBusy) return;
		kometaBusy = true;
		kometaError = null;
		kometaDone = null;
		try {
			kometaPreview = await kometaPost('/api/kometa/config/preview');
			if (kometaPreview.parseError) kometaError = kometaPreview.parseError;
		} catch {
			kometaError = m.kometa_request_failed();
		} finally {
			kometaBusy = false;
		}
	}

	async function kometaDoSync() {
		if (kometaBusy) return;
		kometaBusy = true;
		kometaError = null;
		try {
			const result = await kometaPost('/api/kometa/config/sync');
			if (result.parseError) {
				kometaError = result.parseError;
			} else {
				kometaDone = result.scaffolded ? 'created' : 'synced';
				kometaPreview = null;
				await invalidateAll();
			}
		} catch {
			kometaError = m.kometa_request_failed();
		} finally {
			kometaBusy = false;
		}
	}

	let saving = $state(false);
	let testing = $state(false);
	let saved = $state(false);
	let saveError = $state<string | null>(null);
	let testError = $state<string | null>(null);
	let manualOpen = $state(false);
	let testResult = $state<{
		serverType?: string;
		plex: { ok: boolean; error?: string };
		tmdb: { ok: boolean; error?: string };
	} | null>(null);

	// Validate the integer fields before saving; returns an error string or null.
	// A type=number bind yields number | null (empty), so coerce through String.
	function validateNumbers(): string | null {
		const checks: [unknown, string, number][] = [
			[mediuxDelayMs, m.settings_delay(), 0],
			[mediuxConcurrency, m.settings_concurrency(), 1],
			[httpCacheTtlDays, m.settings_cache_days(), 0]
		];
		for (const [raw, label, min] of checks) {
			const s = String(raw ?? '').trim();
			const n = Number(s);
			if (s === '' || !Number.isInteger(n) || n < min) {
				return m.settings_invalid_number({ field: label, min });
			}
		}
		return null;
	}

	async function save() {
		if (saving) return;
		const invalid = validateNumbers();
		if (invalid) {
			saveError = invalid;
			saved = false;
			return;
		}
		saving = true;
		saved = false;
		saveError = null;
		try {
			const payload: Record<string, unknown> = {
				serverType,
				plexUrl,
				jellyfinUrl,
				embyUrl,
				kometaAssetsDir,
				// Kometa config-sync paths (saved through the shared Save; the preview/sync
				// actions below use these but do not persist them themselves).
				kometaConfigPath,
				kometaMetadataPath,
				kometaConfigMode: kometaMode,
				// type=number binds yield numbers; the settings API only persists string
				// values, so stringify these before sending.
				mediuxDelayMs: String(mediuxDelayMs),
				mediuxConcurrency: String(mediuxConcurrency),
				httpCacheTtlDays: String(httpCacheTtlDays),
				defaultApplyMethod
			};
			// Only send secrets when (re)entered, so a blank field keeps the stored value.
			if (plexToken) payload.plexToken = plexToken;
			if (jellyfinApiKey) payload.jellyfinApiKey = jellyfinApiKey;
			if (embyApiKey) payload.embyApiKey = embyApiKey;
			if (tmdbKey) payload.tmdbKey = tmdbKey;
			if (fanartKey) payload.fanartKey = fanartKey;
			payload.providerMediux = String(providerMediux);
			payload.providerTmdb = String(providerTmdb);
			payload.providerFanart = String(providerFanart);
			payload.providerThePosterDb = String(providerThePosterDb);
			// All known sections selected → [] (sync everything, incl. future libraries).
			payload.includedSections = allSelected ? [] : [...selectedSections];

			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error(String(res.status));
			// Only clear the secret fields and confirm once the write actually succeeded,
			// so a failed save never looks successful and never drops re-entered secrets.
			plexToken = '';
			jellyfinApiKey = '';
			embyApiKey = '';
			tmdbKey = '';
			fanartKey = '';
			saved = true;
			await invalidateAll();
		} catch {
			saveError = m.settings_save_failed();
		} finally {
			saving = false;
		}
	}

	async function test() {
		if (testing) return;
		testing = true;
		testResult = null;
		testError = null;
		try {
			const res = await fetch('/api/settings/test', { method: 'POST' });
			if (!res.ok) throw new Error(String(res.status));
			testResult = await res.json();
		} catch {
			testError = m.settings_test_failed();
		} finally {
			testing = false;
		}
	}

	const serverLabel = $derived(
		serverType === 'jellyfin' ? 'Jellyfin' : serverType === 'emby' ? 'Emby' : 'Plex'
	);

	// Persist the preferred language through the same path as the header switcher
	// (writes the `language` setting, then reloads so SSR re-renders in the locale).
	// Show a pending state immediately: the persist + reload takes a beat, and
	// without feedback the switch looks like it did nothing.
	let switchingLocale = $state(false);
	function changeLanguage(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === language) return;
		language = value as typeof language;
		switchingLocale = true;
		Promise.resolve(setLocale(value as Parameters<typeof setLocale>[0])).catch(() => {
			switchingLocale = false;
		});
	}
</script>

<svelte:head><title>{m.settings_title()} · PosterPilot</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">{m.settings_title()}</h1>

<div class="mt-5 flex flex-wrap gap-1 border-b border-neutral-800">
	{#each tabs as t (t.key)}
		<button
			onclick={() => (tab = t.key)}
			class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition {tab === t.key
				? 'border-accent-500 text-accent-200'
				: 'border-transparent text-neutral-400 hover:text-neutral-100'}"
		>
			{t.label()}
		</button>
	{/each}
</div>

<div class="mt-6 max-w-xl space-y-5">
	{#if tab === 'server'}
		<div>
			<label for="serverType" class="mb-1 block text-sm font-medium"
				>{m.settings_media_server()}</label
			>
			<select id="serverType" bind:value={serverType} disabled={env.serverType} class="input">
				<option value="plex">Plex</option>
				<option value="jellyfin">Jellyfin</option>
				<option value="emby">Emby</option>
			</select>
			{#if env.serverType}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
		</div>

		{#if serverType === 'plex'}
			<div class="surface space-y-4 p-4">
				<PlexLogin bind:plexUrl bind:plexTokenSet onLogin={() => invalidateAll()} />

				<details bind:open={manualOpen} class="border-t border-neutral-800 pt-3">
					<summary class="cursor-pointer text-sm text-neutral-400 hover:text-neutral-200">
						{m.settings_advanced_manual()}
					</summary>
					<div class="mt-3">
						<label for="plexToken" class="mb-1 block text-sm font-medium"
							>{m.settings_plex_token_manual()}</label
						>
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
				<div>
					<label for="jellyfinUrl" class="mb-1 block text-sm font-medium"
						>{m.settings_jellyfin_url()}</label
					>
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
					<label for="jellyfinApiKey" class="mb-1 block text-sm font-medium"
						>{m.settings_jellyfin_api_key()}</label
					>
					<input
						id="jellyfinApiKey"
						type="password"
						bind:value={jellyfinApiKey}
						disabled={env.jellyfinApiKey}
						placeholder={data.config.jellyfinApiKeySet
							? m.settings_secret_placeholder_set()
							: m.settings_jellyfin_api_key_placeholder_unset()}
						class="input w-full disabled:opacity-50"
					/>
					{#if env.jellyfinApiKey}<p class="mt-1 text-xs text-amber-400">
							{m.settings_set_from_env()}
						</p>{/if}
				</div>
			</div>
		{:else}
			<div class="surface space-y-4 p-4">
				<div>
					<label for="embyUrl" class="mb-1 block text-sm font-medium">{m.settings_emby_url()}</label
					>
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
					<label for="embyApiKey" class="mb-1 block text-sm font-medium"
						>{m.settings_emby_api_key()}</label
					>
					<input
						id="embyApiKey"
						type="password"
						bind:value={embyApiKey}
						disabled={env.embyApiKey}
						placeholder={data.config.embyApiKeySet
							? m.settings_secret_placeholder_set()
							: m.settings_emby_api_key_placeholder_unset()}
						class="input w-full disabled:opacity-50"
					/>
					{#if env.embyApiKey}<p class="mt-1 text-xs text-amber-400">
							{m.settings_set_from_env()}
						</p>{/if}
				</div>
			</div>
		{/if}

		<div>
			<div class="mb-1 flex items-center gap-2">
				<span class="text-sm font-medium">{m.settings_libraries_to_sync()}</span>
				<button
					type="button"
					onclick={refreshLibraries}
					disabled={refreshingLibs}
					class="btn btn-ghost px-2 py-0.5 text-xs"
				>
					{refreshingLibs ? m.settings_libraries_refreshing() : m.settings_libraries_refresh()}
				</button>
			</div>
			{#if libsError}
				<p class="mb-2 text-xs text-amber-400">
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
								onchange={() => toggleSection(section.key)}
							/>
							{section.title}
							<span class="text-xs text-neutral-400">({section.type})</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
	{:else if tab === 'providers'}
		<div>
			<label for="tmdbKey" class="mb-1 block text-sm font-medium">{m.settings_tmdb_key()}</label>
			<input
				id="tmdbKey"
				type="password"
				bind:value={tmdbKey}
				disabled={env.tmdbKey}
				placeholder={data.config.tmdbKeySet
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
					<input
						type="checkbox"
						bind:checked={providerMediux}
						disabled={data.config.envManaged.providerMediux}
					/>
					{m.settings_provider_mediux()}
				</label>
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input
						type="checkbox"
						bind:checked={providerTmdb}
						disabled={data.config.envManaged.providerTmdb}
					/>
					{m.settings_provider_tmdb()}
				</label>
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input
						type="checkbox"
						bind:checked={providerFanart}
						disabled={data.config.envManaged.providerFanart}
					/>
					{m.settings_provider_fanart()}
				</label>
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input
						type="checkbox"
						bind:checked={providerThePosterDb}
						disabled={data.config.envManaged.providerThePosterDb}
					/>
					{m.settings_provider_theposterdb()}
					<span class="text-xs text-neutral-400">{m.settings_experimental()}</span>
				</label>
			</div>
			<div class="mt-3">
				<label for="fanartKey" class="mb-1 block text-sm font-medium"
					>{m.settings_fanart_key()}</label
				>
				<input
					id="fanartKey"
					type="password"
					bind:value={fanartKey}
					disabled={data.config.envManaged.fanartKey}
					placeholder={data.config.fanartKeySet
						? m.settings_secret_placeholder_set()
						: m.settings_fanart_key_placeholder_unset()}
					class="input w-full disabled:opacity-50"
				/>
				{#if data.config.envManaged.fanartKey}<p class="mt-1 text-xs text-amber-400">
						{m.settings_set_from_env()}
					</p>{/if}
			</div>
		</div>
	{:else if tab === 'advanced'}
		<div>
			<label for="kometaAssetsDir" class="mb-1 block text-sm font-medium"
				>{m.settings_kometa_dir()}</label
			>
			<input
				id="kometaAssetsDir"
				bind:value={kometaAssetsDir}
				disabled={env.kometaAssetsDir}
				class="input w-full disabled:opacity-50"
			/>
			<p class="mt-1 text-xs text-neutral-400">{m.settings_kometa_dir_hint()}</p>
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
			<label for="method" class="mb-1 block text-sm font-medium"
				>{m.settings_default_apply_method()}</label
			>
			<select id="method" bind:value={defaultApplyMethod} class="input">
				<option value="both">{m.settings_method_both({ server: serverLabel })}</option>
				<option value="plex">{m.settings_method_server_only({ server: serverLabel })}</option>
				<option value="kometa">{m.settings_method_kometa_only()}</option>
			</select>
		</div>
	{:else if tab === 'kometa'}
		<div>
			<label for="kometaConfigPath" class="mb-1 block text-sm font-medium"
				>{m.kometa_config_path()}</label
			>
			<input
				id="kometaConfigPath"
				bind:value={kometaConfigPath}
				disabled={env.kometaConfigPath}
				placeholder="/config/config.yml"
				class="input w-full disabled:opacity-50"
			/>
			<p class="mt-1 text-xs text-neutral-400">{m.kometa_config_path_hint()}</p>
			{#if env.kometaConfigPath}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
			{#if data.kometa.active}
				<p class="mt-1 text-xs text-neutral-500">
					{m.kometa_config_resolved({ path: data.kometa.resolvedConfigPath })}
				</p>
				{#if data.kometa.configPathRelative}
					<p class="mt-1 text-xs text-amber-400">{m.kometa_config_relative_warning()}</p>
				{/if}
			{:else}
				<p class="mt-2 text-xs text-neutral-400">{m.kometa_setup_hint()}</p>
			{/if}
		</div>

		<div>
			<label for="kometaMetadataPath" class="mb-1 block text-sm font-medium"
				>{m.kometa_metadata_path()}</label
			>
			<input
				id="kometaMetadataPath"
				bind:value={kometaMetadataPath}
				disabled={env.kometaMetadataPath}
				class="input w-full disabled:opacity-50"
			/>
			<p class="mt-1 text-xs text-neutral-400">{m.kometa_metadata_path_hint()}</p>
			<p class="mt-1 text-xs text-neutral-500">
				{m.kometa_metadata_resolved({ path: data.kometa.metadataFile })}
			</p>
			{#if env.kometaMetadataPath}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
		</div>

		<div>
			<label for="kometaMode" class="mb-1 block text-sm font-medium">{m.kometa_mode()}</label>
			<select
				id="kometaMode"
				bind:value={kometaMode}
				disabled={env.kometaConfigMode}
				class="input disabled:opacity-50"
			>
				<option value="merge">{m.kometa_mode_merge()}</option>
				<option value="own">{m.kometa_mode_own()}</option>
			</select>
			<p class="mt-1 text-xs text-neutral-400">
				{kometaMode === 'own' ? m.kometa_mode_own_hint() : m.kometa_mode_merge_hint()}
			</p>
			{#if env.kometaConfigMode}<p class="mt-1 text-xs text-amber-400">
					{m.settings_set_from_env()}
				</p>{/if}
			{#if kometaMode === 'own'}<p class="mt-2 text-xs text-amber-400">
					{m.kometa_mode_own_warning()}
				</p>{/if}
		</div>

		<p class="text-xs text-neutral-400">{m.kometa_plex_only_note()}</p>

		{#if data.kometa.active}
			{#if data.kometa.parseError}
				<div class="surface p-3 text-sm text-red-300" role="alert">
					{m.kometa_parse_error({ error: data.kometa.parseError })}
				</div>
			{:else if !data.kometa.exists}
				<p class="text-xs text-amber-400">{m.kometa_will_scaffold()}</p>
			{/if}

			{#if !data.config.plexUrl || !data.config.plexTokenSet}
				<p class="text-xs text-amber-400">{m.kometa_missing_plex_creds()}</p>
			{/if}

			<div>
				<span class="mb-1 block text-sm font-medium">{m.kometa_libraries()}</span>
				<p class="mb-2 text-xs text-neutral-400">{m.kometa_libraries_hint()}</p>
				{#if sections.length === 0}
					<p class="text-xs text-neutral-400">{m.kometa_no_libraries()}</p>
				{:else}
					<div class="space-y-1">
						{#each sections as section (section.key)}
							<label class="flex items-center gap-2 text-sm text-neutral-300">
								<input
									type="checkbox"
									checked={kometaLibs.has(section.key)}
									onchange={() => kometaToggleLib(section.key)}
								/>
								{section.title}
								<span class="text-xs text-neutral-400">({section.type})</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>

			{#each sections.filter((s) => kometaLibs.has(s.key)) as section (section.key)}
				<div class="surface space-y-3 p-4">
					<p class="text-sm font-medium">
						{m.kometa_defaults_for({ library: section.title })}
					</p>
					<p class="text-xs text-neutral-400">{m.kometa_defaults_hint()}</p>
					{#each data.kometa.catalog as group (group.id)}
						<div>
							<p class="mb-1 text-xs font-medium text-neutral-400">
								{kometaGroupLabel[group.id]?.() ?? group.id}
							</p>
							<div class="flex flex-wrap gap-x-4 gap-y-1">
								{#each group.collections as c (c.name)}
									<label class="flex items-center gap-2 text-sm text-neutral-300">
										<input
											type="checkbox"
											checked={kometaDefaultsFor(section.key).has(c.name)}
											onchange={() => kometaToggleDefault(section.key, c.name)}
										/>
										{c.name}
									</label>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/each}

			<div>
				<span class="mb-1 block text-sm font-medium">{m.kometa_settings_heading()}</span>
				<p class="mb-2 text-xs text-neutral-400">{m.kometa_settings_hint()}</p>
				<div class="space-y-3">
					{#each data.kometa.managedSettingDefs as def (def.id)}
						<div>
							<label for="kometa-set-{def.id}" class="mb-1 block text-sm text-neutral-300">
								{kometaSettingLabel[def.id]?.() ?? def.id}
							</label>
							<input
								id="kometa-set-{def.id}"
								bind:value={kometaSettings[def.id]}
								placeholder={def.placeholder ?? ''}
								class="input w-full"
							/>
						</div>
					{/each}
				</div>
			</div>

			<p class="text-xs text-amber-400">{m.kometa_secrets_note()}</p>

			<div class="flex items-center gap-3 border-t border-neutral-800 pt-4">
				<button
					type="button"
					onclick={kometaDoPreview}
					disabled={kometaBusy}
					class="btn btn-subtle px-4 py-2"
				>
					{kometaBusy ? m.kometa_previewing() : m.kometa_preview()}
				</button>
				<button
					type="button"
					onclick={kometaDoSync}
					disabled={kometaBusy || !!data.kometa.parseError}
					class="btn btn-accent px-4 py-2"
				>
					{kometaBusy ? m.kometa_syncing() : m.kometa_sync()}
				</button>
				{#if kometaDone === 'synced'}<span class="text-sm text-emerald-400" role="status"
						>{m.kometa_synced()}</span
					>{/if}
				{#if kometaDone === 'created'}<span class="text-sm text-emerald-400" role="status"
						>{m.kometa_created()}</span
					>{/if}
			</div>

			{#if kometaError}
				<div class="surface p-3 text-sm text-red-300" role="alert">{kometaError}</div>
			{/if}

			{#if kometaPreview}
				<div class="surface space-y-2 p-3 text-sm">
					{#if kometaPreview.warnings.length}
						<p class="text-amber-400">
							{m.kometa_warnings({ sections: kometaPreview.warnings.join(', ') })}
						</p>
					{/if}
					{#if kometaPreview.dropped.length}
						<p class="text-red-300">
							{m.kometa_dropped({ keys: kometaPreview.dropped.join(', ') })}
						</p>
					{/if}
					{#if kometaPreview.changes.length === 0}
						<p class="text-neutral-400">{m.kometa_preview_none()}</p>
					{:else}
						<ul class="space-y-1">
							{#each kometaPreview.changes as change, i (i)}
								<li class="flex items-baseline gap-2 font-mono text-xs">
									<span
										class={change.op === 'remove'
											? 'text-red-300'
											: change.op === 'add'
												? 'text-emerald-300'
												: 'text-amber-300'}>{change.op}</span
									>
									<span class="text-neutral-300">{change.path}</span>
									{#if change.after != null}<span class="text-neutral-500">→ {change.after}</span
										>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{/if}
	{:else if tab === 'language'}
		<div>
			<label for="language" class="mb-1 block text-sm font-medium">{m.settings_language()}</label>
			<div class="flex items-center gap-2">
				<select
					id="language"
					value={language}
					onchange={changeLanguage}
					disabled={switchingLocale}
					class="input disabled:opacity-60"
				>
					{#each data.availableLocales as loc (loc.code)}
						<option value={loc.code}>{loc.name}</option>
					{/each}
				</select>
				{#if switchingLocale}
					<svg
						class="size-4 animate-spin text-accent-400"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="3"
						/>
						<path
							class="opacity-90"
							fill="currentColor"
							d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
						/>
					</svg>
				{/if}
			</div>
		</div>
	{:else}
		<div>
			<div class="flex flex-wrap items-center gap-1">
				{#each levelFilters as f (f.key)}
					<button
						type="button"
						onclick={() => setEventLevel(f.key)}
						class="chip {eventLevel === f.key ? 'chip-active' : ''}"
					>
						{f.label()}
					</button>
				{/each}
				<button
					type="button"
					onclick={clearEvents}
					onblur={() => (confirmingClear = false)}
					disabled={clearingEvents || events.length === 0}
					title={confirmingClear ? m.events_clear_confirm() : undefined}
					class="btn ml-auto {confirmingClear
						? 'bg-red-900/50 text-red-300 hover:bg-red-900/70'
						: 'btn-ghost'}"
				>
					{confirmingClear ? m.events_clear_confirm_action() : m.events_clear()}
				</button>
			</div>

			<div class="surface mt-4 overflow-hidden">
				{#if events.length === 0}
					<p class="p-4 text-sm text-neutral-400">{m.events_empty()}</p>
				{:else}
					<table class="w-full text-sm">
						<thead class="text-left text-xs text-neutral-400">
							<tr class="border-b border-neutral-800">
								<th class="px-4 py-2 font-medium">{m.events_col_level()}</th>
								<th class="px-4 py-2 font-medium">{m.events_col_type()}</th>
								<th class="px-4 py-2 font-medium">{m.events_col_message()}</th>
								<th class="px-4 py-2 font-medium">{m.events_col_time()}</th>
							</tr>
						</thead>
						<tbody>
							{#each events as event (event.id)}
								<tr class="border-b border-neutral-800/60 align-top last:border-0">
									<td class="px-4 py-2">
										<span class={eventBadgeClass[event.level] ?? 'badge badge-muted'}>
											{event.level}
										</span>
									</td>
									<td class="px-4 py-2 text-neutral-400">{event.type}</td>
									<td class="px-4 py-2 text-neutral-200">{event.message}</td>
									<td class="px-4 py-2 whitespace-nowrap text-neutral-400"
										>{fmtTime(event.createdAt)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>

			{#if eventsCursor != null}
				<div class="mt-4 text-center">
					<button
						type="button"
						onclick={() => loadEvents({ before: eventsCursor })}
						disabled={eventsLoading}
						class="btn btn-ghost"
					>
						{eventsLoading ? m.settings_activity_loading() : m.events_load_more()}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if tab !== 'activity'}
		<div class="flex items-center gap-3 border-t border-neutral-800 pt-4">
			<button onclick={save} disabled={saving} class="btn btn-accent px-4 py-2"
				>{saving ? m.settings_saving() : m.settings_save()}</button
			>
			<button onclick={test} disabled={testing} class="btn btn-subtle px-4 py-2"
				>{testing ? m.settings_testing() : m.settings_test_connections()}</button
			>
			{#if saved}<span class="text-sm text-emerald-400" role="status">{m.settings_saved()}</span
				>{/if}
			{#if saveError}<span class="text-sm text-red-300" role="alert">{saveError}</span>{/if}
		</div>

		{#if testError}
			<div class="surface p-3 text-sm text-red-300" role="alert">{testError}</div>
		{/if}

		{#if testResult}
			<div class="surface space-y-1 p-3 text-sm">
				<p>
					{serverLabel}: {testResult.plex.ok
						? m.settings_test_result_ok()
						: m.settings_test_result_fail({ error: testResult.plex.error ?? '' })}
				</p>
				<p>
					TMDB: {testResult.tmdb.ok
						? m.settings_test_result_ok()
						: m.settings_test_result_fail({ error: testResult.tmdb.error ?? '' })}
				</p>
			</div>
		{/if}
	{/if}
</div>

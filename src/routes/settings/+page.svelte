<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import ActivitySettings from '$lib/components/settings/ActivitySettings.svelte';
	import AdvancedSettings from '$lib/components/settings/AdvancedSettings.svelte';
	import AutomationSettings from '$lib/components/settings/AutomationSettings.svelte';
	import BackupRestoreSettings from '$lib/components/settings/BackupRestoreSettings.svelte';
	import DiagnosticsSettings from '$lib/components/settings/DiagnosticsSettings.svelte';
	import LanguageSettings from '$lib/components/settings/LanguageSettings.svelte';
	import ProviderSettings from '$lib/components/settings/ProviderSettings.svelte';
	import SecuritySettings from '$lib/components/settings/SecuritySettings.svelte';
	import ServerSettings from '$lib/components/settings/ServerSettings.svelte';
	import type { LibrarySort } from '$lib/library-sort';
	import { m } from '$lib/paraglide/messages';
	import { toasts } from '$lib/stores/toasts.svelte';

	let { data } = $props();
	const initialData = untrack(() => data);
	const env = initialData.config.envManaged;

	type Section = { key: string; title: string; type: string };
	let sections = $state<Section[]>(initialData.sections);
	const selectedSections = new SvelteSet<string>(
		initialData.config.includedSections.length
			? initialData.config.includedSections
			: initialData.sections.map((section) => section.key)
	);
	const allSelected = $derived(
		sections.length > 0 && sections.every((section) => selectedSections.has(section.key))
	);

	function toggleSection(key: string) {
		if (selectedSections.has(key)) selectedSections.delete(key);
		else selectedSections.add(key);
	}

	let refreshingLibs = $state(false);
	let libsError = $state<string | null>(null);
	async function refreshLibraries(announce = false) {
		if (refreshingLibs) return;
		refreshingLibs = true;
		libsError = null;
		try {
			const response = await fetch('/api/plex/sections');
			if (!response.ok) throw new Error('library_refresh_failed');
			const body = (await response.json()) as { sections?: Section[]; error?: string };
			if (!Array.isArray(body.sections) || body.error) throw new Error('library_refresh_failed');
			const wasAll = allSelected || selectedSections.size === 0;
			sections = body.sections;
			if (wasAll) {
				selectedSections.clear();
				for (const section of sections) selectedSections.add(section.key);
			}
			if (announce) toasts.success(m.settings_libraries_refreshed());
		} catch {
			libsError = m.api_error_generic();
			if (announce) {
				toasts.error(m.settings_libraries_refresh_failed({ error: libsError }));
			}
		} finally {
			refreshingLibs = false;
		}
	}

	onMount(() => {
		void refreshLibraries();
	});

	type Tab =
		| 'server'
		| 'providers'
		| 'advanced'
		| 'diagnostics'
		| 'backup'
		| 'automation'
		| 'security'
		| 'language'
		| 'activity';
	const TABS: Tab[] = [
		'server',
		'providers',
		'advanced',
		'diagnostics',
		'backup',
		'automation',
		'security',
		'language',
		'activity'
	];
	const initialTab = untrack(() => page.url.searchParams.get('tab'));
	let tab = $state<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'server');
	const tabs: { key: Tab; label: () => string }[] = [
		{ key: 'server', label: m.settings_tab_server },
		{ key: 'providers', label: m.settings_tab_providers },
		{ key: 'advanced', label: m.settings_tab_advanced },
		{ key: 'diagnostics', label: m.settings_tab_diagnostics },
		{ key: 'backup', label: m.settings_tab_backup },
		{ key: 'automation', label: m.settings_tab_automation },
		{ key: 'security', label: m.settings_tab_security },
		{ key: 'language', label: m.settings_tab_language },
		{ key: 'activity', label: m.settings_tab_activity }
	];

	function selectTab(key: Tab, focus = false) {
		tab = key;
		if (focus) {
			requestAnimationFrame(() => document.getElementById(`settings-tab-${key}`)?.focus());
		}
	}

	function onTabKeydown(event: KeyboardEvent, key: Tab) {
		const index = TABS.indexOf(key);
		let nextIndex: number | null = null;
		if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
		else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
		else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = TABS.length - 1;
		if (nextIndex === null) return;
		event.preventDefault();
		selectTab(TABS[nextIndex], true);
	}

	// Legacy/default connection settings remain one save transaction, but each tab
	// renders through a focused component with an explicit binding contract.
	let serverType = $state<'plex' | 'jellyfin' | 'emby'>(initialData.config.serverType);
	let plexUrl = $state(initialData.config.plexUrl ?? '');
	let plexToken = $state('');
	let plexTokenSet = $state(initialData.config.plexTokenSet);
	let jellyfinUrl = $state(initialData.config.jellyfinUrl ?? '');
	let jellyfinApiKey = $state('');
	let jellyfinApiKeySet = $state(initialData.config.jellyfinApiKeySet);
	let embyUrl = $state(initialData.config.embyUrl ?? '');
	let embyApiKey = $state('');
	let embyApiKeySet = $state(initialData.config.embyApiKeySet);
	let tmdbKey = $state('');
	let kometaAssetsDir = $state(initialData.config.kometaAssetsDir);
	let kometaServerInstanceId = $state(
		initialData.servers.some(
			(server) =>
				server.id === initialData.config.kometaServerInstanceId &&
				server.type === 'plex' &&
				server.enabled &&
				server.disconnectedAt === null
		)
			? (initialData.config.kometaServerInstanceId ?? '')
			: ''
	);
	// Number inputs can become numbers through Svelte's numeric binding.
	let mediuxDelayMs = $state<string | number>(String(initialData.config.mediuxDelayMs));
	let mediuxConcurrency = $state<string | number>(String(initialData.config.mediuxConcurrency));
	let httpCacheTtlDays = $state<string | number>(String(initialData.config.httpCacheTtlDays));
	let defaultApplyMethod = $state<string>(initialData.config.defaultApplyMethod);
	let applyConcurrency = $state<string | number>(String(initialData.config.applyConcurrency));
	let suggestPreselect = $state(initialData.config.suggestPreselect);
	let incrementalSync = $state(initialData.config.incrementalSync);
	let thumbCacheTtlDays = $state<string | number>(String(initialData.config.thumbCacheTtlDays));
	let thumbCacheMaxMb = $state<string | number>(String(initialData.config.thumbCacheMaxMb));
	let funEnabled = $state(initialData.config.funEnabled);
	let libraryDefaultSort = $state<LibrarySort>(initialData.config.libraryDefaultSort);
	let providerMediux = $state(initialData.config.providerMediux);
	let providerTmdb = $state(initialData.config.providerTmdb);
	let providerFanart = $state(initialData.config.providerFanart);
	let providerThePosterDb = $state(initialData.config.providerThePosterDb);
	let fanartKey = $state('');

	type RankingProvider = 'mediux' | 'theposterdb' | 'fanarttv' | 'tmdb';
	let providerPriority = $state<RankingProvider[]>([...initialData.ranking.providerPriority]);
	let scoreWeightInputs = $state<Record<RankingProvider, string>>({
		mediux: String(initialData.ranking.weights.providerWeights.mediux),
		theposterdb: String(initialData.ranking.weights.providerWeights.theposterdb),
		fanarttv: String(initialData.ranking.weights.providerWeights.fanarttv),
		tmdb: String(initialData.ranking.weights.providerWeights.tmdb)
	});
	let scoreResolution = $state<string | number>(
		String(initialData.ranking.weights.resolutionWeight)
	);
	let scoreAspect = $state<string | number>(String(initialData.ranking.weights.aspectWeight));
	const rankingProviderLabels: Record<RankingProvider, string> = {
		mediux: 'MediUX',
		theposterdb: 'ThePosterDB',
		fanarttv: 'Fanart.tv',
		tmdb: 'TMDB'
	};

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

	function validateNumbers(): string | null {
		const checks: [unknown, string, number][] = [
			[mediuxDelayMs, m.settings_delay(), 0],
			[mediuxConcurrency, m.settings_concurrency(), 1],
			[httpCacheTtlDays, m.settings_cache_days(), 0],
			[applyConcurrency, m.settings_apply_concurrency(), 1],
			[thumbCacheTtlDays, m.settings_thumb_cache_ttl(), 0],
			[thumbCacheMaxMb, m.settings_thumb_cache_max(), 0]
		];
		for (const [raw, label, min] of checks) {
			const value = String(raw ?? '').trim();
			const parsed = Number(value);
			if (value === '' || !Number.isInteger(parsed) || parsed < min) {
				return m.settings_invalid_number({ field: label, min });
			}
		}
		for (const [raw, label] of [
			...providerPriority.map(
				(provider) => [scoreWeightInputs[provider], rankingProviderLabels[provider]] as const
			),
			[scoreResolution, m.settings_score_resolution()] as const,
			[scoreAspect, m.settings_score_aspect()] as const
		]) {
			const value = Number(String(raw).trim());
			if (!Number.isFinite(value) || value < 0 || value > 10) {
				return m.settings_invalid_weight({ field: label });
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
				mediuxDelayMs: String(mediuxDelayMs),
				mediuxConcurrency: String(mediuxConcurrency),
				httpCacheTtlDays: String(httpCacheTtlDays),
				defaultApplyMethod,
				applyConcurrency: String(applyConcurrency),
				suggestPreselect: String(suggestPreselect),
				incrementalSync: String(incrementalSync),
				thumbCacheTtlDays: String(thumbCacheTtlDays),
				thumbCacheMaxMb: String(thumbCacheMaxMb),
				funEnabled: String(funEnabled),
				libraryDefaultSort,
				providerMediux: String(providerMediux),
				providerTmdb: String(providerTmdb),
				providerFanart: String(providerFanart),
				providerThePosterDb: String(providerThePosterDb),
				includedSections: allSelected ? [] : [...selectedSections],
				ranking: {
					providerPriority,
					weights: {
						providerWeights: Object.fromEntries(
							providerPriority.map((provider) => [provider, Number(scoreWeightInputs[provider])])
						),
						resolutionWeight: Number(scoreResolution),
						aspectWeight: Number(scoreAspect)
					}
				}
			};
			if (kometaServerInstanceId) payload.kometaServerInstanceId = kometaServerInstanceId;
			if (plexToken) payload.plexToken = plexToken;
			if (jellyfinApiKey) payload.jellyfinApiKey = jellyfinApiKey;
			if (embyApiKey) payload.embyApiKey = embyApiKey;
			if (tmdbKey) payload.tmdbKey = tmdbKey;
			if (fanartKey) payload.fanartKey = fanartKey;

			const response = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!response.ok) throw new Error('settings_save_failed');
			plexToken = '';
			jellyfinApiKey = '';
			embyApiKey = '';
			tmdbKey = '';
			fanartKey = '';
			saved = true;
			toasts.success(m.settings_saved());
			await invalidateAll();
		} catch {
			saveError = m.settings_save_failed();
			toasts.error(saveError);
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
			const response = await fetch('/api/settings/test', { method: 'POST' });
			if (!response.ok) throw new Error('settings_test_failed');
			testResult = await response.json();
			toasts.success(m.settings_connections_tested());
		} catch {
			testError = m.settings_test_failed();
			toasts.error(testError);
		} finally {
			testing = false;
		}
	}

	const serverLabel = $derived(
		serverType === 'jellyfin' ? 'Jellyfin' : serverType === 'emby' ? 'Emby' : 'Plex'
	);
</script>

<svelte:head><title>{m.settings_title()} · PosterPilot</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">{m.settings_title()}</h1>

<div
	class="mt-5 flex flex-wrap gap-1 border-b border-neutral-800"
	role="tablist"
	aria-label={m.settings_title()}
>
	{#each tabs as item (item.key)}
		<button
			id={`settings-tab-${item.key}`}
			type="button"
			role="tab"
			aria-selected={tab === item.key}
			aria-controls="settings-tabpanel"
			tabindex={tab === item.key ? 0 : -1}
			onclick={() => selectTab(item.key)}
			onkeydown={(event) => onTabKeydown(event, item.key)}
			class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition {tab === item.key
				? 'border-accent-500 text-accent-200'
				: 'border-transparent text-neutral-400 hover:text-neutral-100'}"
		>
			{item.label()}
		</button>
	{/each}
</div>

<div
	id="settings-tabpanel"
	role="tabpanel"
	aria-labelledby={`settings-tab-${tab}`}
	class="mt-6 space-y-5 {tab === 'diagnostics' || tab === 'backup' ? 'max-w-4xl' : 'max-w-xl'}"
>
	{#if tab === 'server'}
		<ServerSettings
			initial={data.serverManagement}
			locale={data.locale}
			{env}
			{sections}
			{selectedSections}
			{refreshingLibs}
			{libsError}
			onRefreshLibraries={() => refreshLibraries(true)}
			onToggleSection={toggleSection}
			onLogin={invalidateAll}
			bind:serverType
			bind:plexUrl
			bind:plexToken
			bind:plexTokenSet
			bind:jellyfinUrl
			bind:jellyfinApiKey
			bind:jellyfinApiKeySet
			bind:embyUrl
			bind:embyApiKey
			bind:embyApiKeySet
			bind:manualOpen
		/>
	{:else if tab === 'providers'}
		<ProviderSettings
			tmdbKeySet={data.config.tmdbKeySet}
			fanartKeySet={data.config.fanartKeySet}
			{env}
			bind:tmdbKey
			bind:providerMediux
			bind:providerTmdb
			bind:providerFanart
			bind:providerThePosterDb
			bind:fanartKey
		/>
	{:else if tab === 'advanced'}
		<AdvancedSettings
			servers={data.servers}
			{env}
			{serverLabel}
			rankingSource={data.ranking.source}
			bind:kometaServerInstanceId
			bind:kometaAssetsDir
			bind:mediuxDelayMs
			bind:mediuxConcurrency
			bind:httpCacheTtlDays
			bind:defaultApplyMethod
			bind:providerPriority
			bind:scoreWeightInputs
			bind:scoreResolution
			bind:scoreAspect
			bind:applyConcurrency
			bind:thumbCacheTtlDays
			bind:thumbCacheMaxMb
			bind:suggestPreselect
			bind:incrementalSync
			bind:funEnabled
			bind:libraryDefaultSort
		/>
	{:else if tab === 'diagnostics'}
		<DiagnosticsSettings initial={data.diagnostics} servers={data.servers} locale={data.locale} />
	{:else if tab === 'backup'}
		<BackupRestoreSettings
			initialBackups={data.backups}
			initialPolicy={data.backupPolicy}
			initialHistory={data.restoreHistory}
			locale={data.locale}
		/>
	{:else if tab === 'automation'}
		<AutomationSettings
			initialSchedules={data.automations}
			initialOccurrences={data.automationHistory}
			libraries={sections}
			reviewViews={data.automationReviewViews}
			locale={data.locale}
		/>
	{:else if tab === 'language'}
		<LanguageSettings initialLocale={data.locale} availableLocales={data.availableLocales} />
	{:else if tab === 'security'}
		<SecuritySettings auth={data.auth} />
	{:else}
		<ActivitySettings
			initialEvents={data.events}
			initialCursor={data.eventsNextCursor}
			locale={data.locale}
		/>
	{/if}

	{#if tab === 'server' || tab === 'providers' || tab === 'advanced' || tab === 'language'}
		<div class="flex items-center gap-3 border-t border-neutral-800 pt-4">
			<button onclick={save} disabled={saving} class="btn btn-accent px-4 py-2">
				{saving ? m.settings_saving() : m.settings_save()}
			</button>
			<button onclick={test} disabled={testing} class="btn btn-subtle px-4 py-2">
				{testing ? m.settings_testing() : m.settings_test_connections()}
			</button>
			{#if saved}<span class="text-sm text-emerald-400" role="status">
					{m.settings_saved()}
				</span>{/if}
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
						: m.settings_test_result_fail({ error: m.settings_test_failed() })}
				</p>
				<p>
					TMDB: {testResult.tmdb.ok
						? m.settings_test_result_ok()
						: m.settings_test_result_fail({ error: m.settings_test_failed() })}
				</p>
			</div>
		{/if}
	{/if}
</div>

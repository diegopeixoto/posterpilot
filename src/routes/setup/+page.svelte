<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages';
	import { setLocale } from '$lib/paraglide/runtime';
	import PlexLogin from '$lib/components/PlexLogin.svelte';
	import EmbyLogin from '$lib/components/EmbyLogin.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import { jobStatusLabel } from '$lib/job-labels';

	let { data } = $props();
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	const steps = [
		{ title: m.setup_step_language, desc: m.setup_step_language_desc },
		{ title: m.setup_step_server, desc: m.setup_step_server_desc },
		{ title: m.setup_step_tmdb, desc: m.setup_step_tmdb_desc },
		{ title: m.setup_step_providers, desc: m.setup_step_providers_desc },
		{ title: m.setup_step_libraries, desc: m.setup_step_libraries_desc },
		{ title: m.setup_step_sync, desc: m.setup_step_sync_desc }
	];
	const total = steps.length;
	const LIBRARIES_STEP = 4;
	// svelte-ignore state_referenced_locally
	let step = $state(data.resumeStep);

	// Step values, seeded from current config (so re-running the wizard is sane).
	// svelte-ignore state_referenced_locally
	let language = $state(data.locale);
	// svelte-ignore state_referenced_locally
	let serverType = $state<'plex' | 'jellyfin' | 'emby'>(data.config.serverType);

	// svelte-ignore state_referenced_locally
	let plexUrl = $state(data.config.plexUrl ?? '');
	// svelte-ignore state_referenced_locally
	let plexTokenSet = $state(data.config.plexTokenSet);

	// svelte-ignore state_referenced_locally
	let jellyfinUrl = $state(data.config.jellyfinUrl ?? '');
	let jellyfinApiKey = $state('');
	// svelte-ignore state_referenced_locally
	let jellyfinApiKeySet = $state(data.config.jellyfinApiKeySet);
	// svelte-ignore state_referenced_locally
	let embyUrl = $state(data.config.embyUrl ?? '');
	let embyApiKey = $state('');
	// svelte-ignore state_referenced_locally
	let embyApiKeySet = $state(data.config.embyApiKeySet);

	let tmdbKey = $state('');

	// svelte-ignore state_referenced_locally
	let providerMediux = $state(data.config.providerMediux);
	// svelte-ignore state_referenced_locally
	let providerTmdb = $state(data.config.providerTmdb);
	// svelte-ignore state_referenced_locally
	let providerFanart = $state(data.config.providerFanart);
	// svelte-ignore state_referenced_locally
	let providerThePosterDb = $state(data.config.providerThePosterDb);
	let fanartKey = $state('');

	// ── Libraries step ─────────────────────────────────────────────────────────
	// Cached library list (rendered instantly), refreshable live; mirrors the
	// Settings "Libraries to sync" UX (select-all default, Refresh, error states).
	type Section = { key: string; title: string; type: string };
	// svelte-ignore state_referenced_locally
	let sections = $state<Section[]>(data.sections);
	// svelte-ignore state_referenced_locally
	const selectedSections = new SvelteSet<string>(
		data.config.includedSections.length
			? data.config.includedSections
			: data.sections.map((s) => s.key)
	);
	// All known libraries selected → persist [] (sync everything, incl. future ones).
	const allSelected = $derived(
		sections.length > 0 && sections.every((s) => selectedSections.has(s.key))
	);
	function toggleSection(key: string) {
		if (selectedSections.has(key)) selectedSections.delete(key);
		else selectedSections.add(key);
	}

	let refreshingLibs = $state(false);
	let libsError = $state<string | null>(null);
	// Connection signal for the Libraries step: a successful /api/plex/sections
	// fetch (no error) means we reached the server. null = not yet checked.
	let connectionOk = $state<boolean | null>(null);

	async function refreshLibraries() {
		refreshingLibs = true;
		libsError = null;
		try {
			const res = await fetch('/api/plex/sections');
			const body = (await res.json()) as { sections?: Section[]; error?: string };
			if (Array.isArray(body.sections)) {
				const wasAll = allSelected || selectedSections.size === 0;
				sections = body.sections;
				// Preserve "select all" semantics across a refreshed list so a
				// newly-added library defaults to synced.
				if (wasAll) {
					selectedSections.clear();
					for (const s of sections) selectedSections.add(s.key);
				}
			}
			libsError = body.error ? m.api_error_generic() : null;
			connectionOk = !body.error;
		} catch {
			libsError = m.api_error_generic();
			connectionOk = false;
		} finally {
			refreshingLibs = false;
		}
	}

	let busy = $state(false);
	let testing = $state(false);
	let testMsg = $state<{ ok: boolean; text: string } | null>(null);
	let syncing = $state(false);
	let syncJobId = $state<number | null>(null);
	// svelte-ignore state_referenced_locally
	let syncStatus = $state<string | null>(data.successfulSync ? 'completed' : null);
	let stepError = $state<string | null>(null);
	let stepHeading: HTMLHeadingElement | null = $state(null);

	async function focusStepHeading() {
		await tick();
		stepHeading?.focus();
	}

	/**
	 * Block advancing past a step that isn't configured, so a first-timer can't
	 * click straight through to a sync that silently does nothing. Presence-based
	 * (not a live test) so the Plex flow — which has no Test button — isn't trapped.
	 */
	function validateStep(): string | null {
		if (step === 1) {
			if (serverType === 'plex') {
				// Plex needs both a URL and a token, so block if either is missing.
				if (!plexUrl.trim() || !plexTokenSet) return m.setup_need_server();
			} else if (serverType === 'jellyfin') {
				if (!jellyfinUrl.trim() || !(jellyfinApiKey.trim() || jellyfinApiKeySet))
					return m.setup_need_server();
			} else if (!embyUrl.trim() || !(embyApiKey.trim() || embyApiKeySet)) {
				return m.setup_need_server();
			}
		} else if (step === 2) {
			if (!tmdbKey.trim() && !data.config.tmdbKeySet) return m.setup_need_tmdb();
		}
		return null;
	}

	async function postSettings(payload: Record<string, unknown>) {
		const response = await fetch('/api/settings', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(m.api_error_generic());
	}

	function changeLanguage(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		language = value as typeof language;
		// setLocale persists `language` and reloads SSR in the chosen locale.
		setLocale(value as Parameters<typeof setLocale>[0]);
	}

	/** Persist the current step's values, then advance. */
	async function next() {
		if (busy) return;
		const invalid = validateStep();
		if (invalid) {
			stepError = invalid;
			return;
		}
		busy = true;
		stepError = null;
		testMsg = null;
		const startingStep = step;
		// The locale write can cause the locale strategy to refresh the route. Move
		// to the server step synchronously so that refresh cannot recreate the
		// language step while the click handler is awaiting its request.
		if (startingStep === 0) {
			step = 1;
			void focusStepHeading();
		}
		try {
			if (startingStep === 0) {
				// Persist even the already-selected default locale. Relying only on the
				// select's change event makes English users lose their progress after
				// an invalidation or reload because no change event ever fires.
				await postSettings({ language });
				// Re-enter the same route from persisted state. Locale strategies may
				// refresh the layout while this write is in flight; an explicit route
				// navigation makes the resumable server-derived step authoritative.
				await goto('/setup', { invalidateAll: true, replaceState: true, noScroll: true });
				return;
			} else if (startingStep === 1) {
				const payload: Record<string, unknown> = { serverType };
				if (serverType === 'plex') {
					payload.plexUrl = plexUrl;
				} else if (serverType === 'jellyfin') {
					payload.jellyfinUrl = jellyfinUrl;
					if (jellyfinApiKey) payload.jellyfinApiKey = jellyfinApiKey;
				} else {
					payload.embyUrl = embyUrl;
					if (embyApiKey) payload.embyApiKey = embyApiKey;
				}
				await postSettings(payload);
			} else if (startingStep === 2) {
				if (tmdbKey) await postSettings({ tmdbKey });
			} else if (startingStep === 3) {
				const payload: Record<string, unknown> = {
					providerMediux: String(providerMediux),
					providerTmdb: String(providerTmdb),
					providerFanart: String(providerFanart),
					providerThePosterDb: String(providerThePosterDb)
				};
				if (fanartKey) payload.fanartKey = fanartKey;
				await postSettings(payload);
			} else if (startingStep === LIBRARIES_STEP) {
				// All known libraries selected → [] (sync everything, incl. future ones).
				await postSettings({
					includedSections: allSelected ? [] : [...selectedSections]
				});
			}
			if (startingStep !== 0 && step < total - 1) {
				step += 1;
				await focusStepHeading();
				// Arriving at the Libraries step: fetch the server's libraries live.
				if (step === LIBRARIES_STEP) void refreshLibraries();
			}
			// Let the visible wizard advance as soon as its write succeeds. Root/page
			// data can refresh in the background; awaiting invalidation here allowed a
			// concurrent loader remount to strand the user on the completed step.
			void invalidateAll();
		} catch (e) {
			if (startingStep === 0) step = 0;
			stepError = m.setup_save_failed({ error: e instanceof Error ? e.message : String(e) });
		} finally {
			busy = false;
		}
	}

	async function back() {
		testMsg = null;
		stepError = null;
		if (step > 0) {
			step -= 1;
			await focusStepHeading();
		}
	}

	/** Save the current server fields, then test the stored config. */
	async function testServer() {
		testing = true;
		testMsg = null;
		try {
			const payload: Record<string, unknown> = { serverType };
			if (serverType === 'plex') {
				payload.plexUrl = plexUrl;
			} else if (serverType === 'jellyfin') {
				payload.jellyfinUrl = jellyfinUrl;
				if (jellyfinApiKey) payload.jellyfinApiKey = jellyfinApiKey;
			} else {
				payload.embyUrl = embyUrl;
				if (embyApiKey) payload.embyApiKey = embyApiKey;
			}
			await postSettings(payload);
			const res = await fetch('/api/settings/test', { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as { plex?: { ok?: boolean } };
			testMsg =
				res.ok && body.plex?.ok
					? { ok: true, text: m.setup_test_ok() }
					: { ok: false, text: m.setup_test_fail({ error: m.api_error_generic() }) };
		} catch {
			testMsg = {
				ok: false,
				text: m.setup_test_fail({ error: m.api_error_generic() })
			};
		} finally {
			testing = false;
		}
	}

	async function startSync() {
		if (syncing) return;
		syncing = true;
		stepError = null;
		syncStatus = null;
		try {
			const response = await fetch('/api/sync', { method: 'POST' });
			const body = (await response.json().catch(() => ({}))) as {
				jobId?: number;
				error?: string;
			};
			if (!response.ok || !Number.isInteger(body.jobId)) {
				throw new Error(m.api_error_generic());
			}
			syncJobId = body.jobId!;
		} catch (e) {
			syncStatus = 'failed';
			stepError = m.setup_sync_failed({ error: e instanceof Error ? e.message : String(e) });
		} finally {
			syncing = false;
		}
	}

	function onSyncDone(status: string) {
		syncStatus = status;
		if (status !== 'completed') syncJobId = null;
	}

	async function dismissSetup(destination = '/') {
		stepError = null;
		try {
			const response = await fetch('/api/setup/dismiss', { method: 'POST' });
			if (!response.ok) throw new Error(m.api_error_generic());
			await goto(destination);
		} catch (e) {
			stepError = m.setup_skip_failed({ error: e instanceof Error ? e.message : String(e) });
		}
	}
</script>

<svelte:head><title>{m.setup_title()} · PosterPilot</title></svelte:head>

<div class="mx-auto max-w-xl">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold tracking-tight">{m.setup_title()}</h1>
		<button
			type="button"
			onclick={() => dismissSetup()}
			class="text-sm text-neutral-400 underline hover:text-neutral-200"
		>
			{m.setup_skip()}
		</button>
	</div>

	<!-- Progress -->
	<div
		class="mt-4 flex gap-1.5"
		role="progressbar"
		aria-label={m.setup_step({ current: step + 1, total })}
		aria-valuemin="1"
		aria-valuemax={total}
		aria-valuenow={step + 1}
	>
		{#each { length: total } as _, i (i)}
			<div
				aria-hidden="true"
				class="h-1.5 flex-1 rounded-full {i <= step ? 'bg-accent-500' : 'bg-neutral-800'}"
			></div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-neutral-400">{m.setup_step({ current: step + 1, total })}</p>

	<div class="surface mt-4 space-y-4 p-5">
		<div>
			<h2
				bind:this={stepHeading}
				tabindex="-1"
				class="text-lg font-medium focus-visible:outline-none"
			>
				{steps[step].title()}
			</h2>
			<p class="mt-0.5 text-sm text-neutral-400">{steps[step].desc()}</p>
		</div>

		{#if step === 0}
			<div>
				<label for="setup-lang" class="mb-1 block text-sm font-medium"
					>{m.settings_language()}</label
				>
				<select id="setup-lang" value={language} onchange={changeLanguage} class="input w-full">
					{#each data.availableLocales as loc (loc.code)}
						<option value={loc.code}>{loc.name}</option>
					{/each}
				</select>
			</div>
		{:else if step === 1}
			<div>
				<label for="setup-server" class="mb-1 block text-sm font-medium"
					>{m.settings_media_server()}</label
				>
				<select id="setup-server" bind:value={serverType} class="input w-full">
					<option value="plex">{m.setup_plex_choose()}</option>
					<option value="jellyfin">{m.setup_jellyfin_choose()}</option>
					<option value="emby">{m.setup_emby_choose()}</option>
				</select>
			</div>

			{#if serverType === 'plex'}
				<PlexLogin bind:plexUrl bind:plexTokenSet onLogin={() => invalidateAll()} />
			{:else if serverType === 'jellyfin'}
				<EmbyLogin
					flavor="jellyfin"
					bind:serverUrl={jellyfinUrl}
					bind:apiKeySet={jellyfinApiKeySet}
					onLogin={() => invalidateAll()}
				/>
				<details class="border-t border-neutral-800 pt-3">
					<summary class="cursor-pointer text-sm text-neutral-400"
						>{m.setup_api_key_fallback()}</summary
					>
					<div class="mt-3 space-y-3">
						<input
							bind:value={jellyfinUrl}
							aria-label={m.settings_jellyfin_url()}
							placeholder="http://192.168.1.10:8096"
							class="input w-full"
						/>
						<input
							type="password"
							bind:value={jellyfinApiKey}
							aria-label={m.settings_jellyfin_api_key()}
							placeholder={jellyfinApiKeySet
								? m.settings_secret_placeholder_set()
								: m.settings_jellyfin_api_key_placeholder_unset()}
							class="input w-full"
						/>
						<button onclick={testServer} disabled={testing} class="btn btn-subtle px-3 py-1.5"
							>{testing ? m.setup_testing() : m.setup_test()}</button
						>
					</div>
				</details>
			{:else}
				<EmbyLogin
					flavor="emby"
					bind:serverUrl={embyUrl}
					bind:apiKeySet={embyApiKeySet}
					onLogin={() => invalidateAll()}
				/>
				<details class="border-t border-neutral-800 pt-3">
					<summary class="cursor-pointer text-sm text-neutral-400"
						>{m.setup_api_key_fallback()}</summary
					>
					<div class="mt-3 space-y-3">
						<input
							bind:value={embyUrl}
							aria-label={m.settings_emby_url()}
							placeholder="http://192.168.1.10:8096"
							class="input w-full"
						/>
						<input
							type="password"
							bind:value={embyApiKey}
							aria-label={m.settings_emby_api_key()}
							placeholder={embyApiKeySet
								? m.settings_secret_placeholder_set()
								: m.settings_emby_api_key_placeholder_unset()}
							class="input w-full"
						/>
						<button onclick={testServer} disabled={testing} class="btn btn-subtle px-3 py-1.5"
							>{testing ? m.setup_testing() : m.setup_test()}</button
						>
					</div>
				</details>
			{/if}

			{#if testMsg}
				<p
					role={testMsg.ok ? 'status' : 'alert'}
					class="text-sm {testMsg.ok ? 'text-emerald-400' : 'text-red-400'}"
				>
					{testMsg.text}
				</p>
			{/if}
		{:else if step === 2}
			<div>
				<label for="setup-tmdb" class="mb-1 block text-sm font-medium"
					>{m.settings_tmdb_key()}</label
				>
				<input
					id="setup-tmdb"
					type="password"
					bind:value={tmdbKey}
					placeholder={data.config.tmdbKeySet
						? m.settings_secret_placeholder_set()
						: m.settings_tmdb_key_placeholder_unset()}
					class="input w-full"
				/>
				<p class="mt-1 text-xs text-neutral-400">
					{m.setup_tmdb_get_key_pre()}
					<a
						href="https://www.themoviedb.org/settings/api"
						target="_blank"
						rel="noopener"
						class="text-accent-300 underline">{m.setup_tmdb_get_key_link()}</a
					>.
				</p>
			</div>
		{:else if step === 3}
			<div class="space-y-1">
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input type="checkbox" bind:checked={providerMediux} />
					{m.settings_provider_mediux()}
				</label>
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input type="checkbox" bind:checked={providerTmdb} />
					{m.settings_provider_tmdb()}
				</label>
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input type="checkbox" bind:checked={providerFanart} />
					{m.settings_provider_fanart()}
				</label>
				<label class="flex items-center gap-2 text-sm text-neutral-300">
					<input type="checkbox" bind:checked={providerThePosterDb} />
					{m.settings_provider_theposterdb()}
					<span class="text-xs text-neutral-400">{m.settings_experimental()}</span>
				</label>
			</div>
			<div>
				<label for="setup-fanart" class="mb-1 block text-sm font-medium"
					>{m.settings_fanart_key()}</label
				>
				<input
					id="setup-fanart"
					type="password"
					bind:value={fanartKey}
					placeholder={data.config.fanartKeySet
						? m.settings_secret_placeholder_set()
						: m.settings_fanart_key_placeholder_unset()}
					class="input w-full"
				/>
			</div>
		{:else if step === LIBRARIES_STEP}
			<!-- Connection state -->
			<div class="surface flex items-center gap-2 p-3 text-sm">
				{#if refreshingLibs && connectionOk === null}
					<span role="status" class="text-neutral-400">{m.setup_libraries_checking()}</span>
				{:else if connectionOk === true}
					<span class="text-emerald-400">{m.setup_libraries_connected()}</span>
				{:else if connectionOk === false}
					<span class="text-red-400">{m.setup_libraries_not_connected()}</span>
				{:else}
					<span class="text-neutral-400">{m.setup_libraries_check_hint()}</span>
				{/if}
			</div>

			<!-- Library checklist (mirrors the Settings "Libraries to sync" UX) -->
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
								<span class="text-xs text-neutral-400">
									({section.type === 'movie'
										? m.manual_match_type_movie()
										: m.manual_match_type_show()})
								</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="space-y-3">
				<button
					onclick={startSync}
					disabled={syncing || syncStatus === 'completed' || syncJobId !== null}
					class="btn btn-accent px-4 py-2"
				>
					{syncing ? m.setup_sync_running() : m.setup_sync_start()}
				</button>
				{#if syncJobId !== null}
					<JobProgress jobId={syncJobId} onDone={onSyncDone} />
				{/if}
				{#if syncStatus === 'completed'}
					<p class="text-sm text-emerald-400" role="status">{m.setup_done()}</p>
					<button onclick={() => dismissSetup('/')} class="btn btn-subtle px-4 py-2"
						>{m.setup_go_dashboard()}</button
					>
				{:else if syncStatus && syncStatus !== 'completed'}
					<p role="alert" class="text-sm text-red-300">
						{m.setup_sync_terminal_failed({ status: jobStatusLabel(syncStatus) })}
					</p>
					<button onclick={startSync} disabled={syncing} class="btn btn-subtle px-4 py-2"
						>{m.setup_sync_retry()}</button
					>
				{/if}
			</div>
		{/if}

		{#if stepError}
			<p class="mt-4 text-sm text-red-300" role="alert">{stepError}</p>
		{/if}

		{#if step < total - 1}
			<div class="flex items-center gap-3 border-t border-neutral-800 pt-4">
				{#if step > 0}
					<button onclick={back} class="btn btn-ghost px-4 py-2">{m.setup_back()}</button>
				{/if}
				<button
					onclick={next}
					disabled={busy || !hydrated}
					class="btn btn-accent ml-auto px-4 py-2"
				>
					{busy ? m.setup_saving() : m.setup_next()}
				</button>
			</div>
		{:else}
			<div class="flex items-center gap-3 border-t border-neutral-800 pt-4">
				<button onclick={back} class="btn btn-ghost px-4 py-2">{m.setup_back()}</button>
			</div>
		{/if}
	</div>
</div>

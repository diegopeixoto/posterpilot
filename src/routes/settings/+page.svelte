<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';

	let { data } = $props();
	const env = data.config.envManaged;

	const allSectionKeys = data.sections.map((s) => s.key);
	const selectedSections = new SvelteSet<string>(
		data.config.includedSections.length ? data.config.includedSections : allSectionKeys
	);
	function toggleSection(key: string) {
		if (selectedSections.has(key)) selectedSections.delete(key);
		else selectedSections.add(key);
	}

	let plexUrl = $state(data.config.plexUrl ?? '');
	let plexToken = $state('');
	let tmdbKey = $state('');
	let kometaAssetsDir = $state(data.config.kometaAssetsDir);
	let mediuxDelayMs = $state(String(data.config.mediuxDelayMs));
	let mediuxConcurrency = $state(String(data.config.mediuxConcurrency));
	let httpCacheTtlDays = $state(String(data.config.httpCacheTtlDays));
	let defaultApplyMethod = $state(data.config.defaultApplyMethod);

	let saving = $state(false);
	let testing = $state(false);
	let saved = $state(false);
	let testResult = $state<{
		plex: { ok: boolean; error?: string };
		tmdb: { ok: boolean; error?: string };
	} | null>(null);

	async function save() {
		saving = true;
		saved = false;
		try {
			const payload: Record<string, unknown> = {
				plexUrl,
				kometaAssetsDir,
				mediuxDelayMs,
				mediuxConcurrency,
				httpCacheTtlDays,
				defaultApplyMethod
			};
			// Only send secrets when (re)entered, so a blank field keeps the stored value.
			if (plexToken) payload.plexToken = plexToken;
			if (tmdbKey) payload.tmdbKey = tmdbKey;
			// All sections selected → [] (sync everything, incl. future libraries).
			const sel = [...selectedSections];
			payload.includedSections = sel.length === allSectionKeys.length ? [] : sel;

			await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			plexToken = '';
			tmdbKey = '';
			saved = true;
			await invalidateAll();
		} finally {
			saving = false;
		}
	}

	async function test() {
		testing = true;
		testResult = null;
		try {
			const res = await fetch('/api/settings/test', { method: 'POST' });
			testResult = await res.json();
		} finally {
			testing = false;
		}
	}
</script>

<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>

<div class="mt-6 max-w-xl space-y-5">
	<div>
		<label for="plexUrl" class="mb-1 block text-sm font-medium">Plex URL</label>
		<input
			id="plexUrl"
			bind:value={plexUrl}
			disabled={env.plexUrl}
			placeholder="http://192.168.1.10:32400"
			class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
		/>
		{#if env.plexUrl}<p class="mt-1 text-xs text-amber-400">Set from environment</p>{/if}
	</div>

	<div>
		<label for="plexToken" class="mb-1 block text-sm font-medium">Plex token</label>
		<input
			id="plexToken"
			type="password"
			bind:value={plexToken}
			disabled={env.plexToken}
			placeholder={data.config.plexTokenSet
				? '•••••••• (set — leave blank to keep)'
				: 'X-Plex-Token'}
			class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
		/>
		{#if env.plexToken}<p class="mt-1 text-xs text-amber-400">Set from environment</p>{/if}
	</div>

	<div>
		<label for="tmdbKey" class="mb-1 block text-sm font-medium">TMDB key (v3 key or v4 JWT)</label>
		<input
			id="tmdbKey"
			type="password"
			bind:value={tmdbKey}
			disabled={env.tmdbKey}
			placeholder={data.config.tmdbKeySet
				? '•••••••• (set — leave blank to keep)'
				: 'TMDB credential'}
			class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
		/>
		{#if env.tmdbKey}<p class="mt-1 text-xs text-amber-400">Set from environment</p>{/if}
	</div>

	<div>
		<label for="kometaAssetsDir" class="mb-1 block text-sm font-medium"
			>Kometa assets directory</label
		>
		<input
			id="kometaAssetsDir"
			bind:value={kometaAssetsDir}
			disabled={env.kometaAssetsDir}
			class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-accent-500 disabled:opacity-50"
		/>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div>
			<label for="delay" class="mb-1 block text-sm font-medium">Delay (ms)</label>
			<input
				id="delay"
				bind:value={mediuxDelayMs}
				class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
			/>
		</div>
		<div>
			<label for="conc" class="mb-1 block text-sm font-medium">Concurrency</label>
			<input
				id="conc"
				bind:value={mediuxConcurrency}
				class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
			/>
		</div>
		<div>
			<label for="ttl" class="mb-1 block text-sm font-medium">Cache (days)</label>
			<input
				id="ttl"
				bind:value={httpCacheTtlDays}
				class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
			/>
		</div>
	</div>

	<div>
		<label for="method" class="mb-1 block text-sm font-medium">Default apply method</label>
		<select
			id="method"
			bind:value={defaultApplyMethod}
			class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm"
		>
			<option value="both">Plex + Kometa</option>
			<option value="plex">Plex only</option>
			<option value="kometa">Kometa only</option>
		</select>
	</div>

	<div>
		<span class="mb-1 block text-sm font-medium">Libraries to sync</span>
		{#if data.sections.length === 0}
			<p class="text-xs text-neutral-500">
				Connect Plex and save, then reload to choose libraries.
			</p>
		{:else}
			<p class="mb-2 text-xs text-neutral-500">
				Uncheck libraries you don't want synced (e.g. a YouTube collection). All checked syncs
				everything.
			</p>
			<div class="space-y-1">
				{#each data.sections as section (section.key)}
					<label class="flex items-center gap-2 text-sm text-neutral-300">
						<input
							type="checkbox"
							checked={selectedSections.has(section.key)}
							onchange={() => toggleSection(section.key)}
						/>
						{section.title}
						<span class="text-xs text-neutral-500">({section.type})</span>
					</label>
				{/each}
			</div>
		{/if}
	</div>

	<div class="flex items-center gap-3 pt-2">
		<button onclick={save} disabled={saving} class="btn btn-accent px-4 py-2"
			>{saving ? 'Saving…' : 'Save'}</button
		>
		<button onclick={test} disabled={testing} class="btn btn-subtle px-4 py-2"
			>{testing ? 'Testing…' : 'Test connections'}</button
		>
		{#if saved}<span class="text-sm text-emerald-400">Saved</span>{/if}
	</div>

	{#if testResult}
		<div class="surface space-y-1 p-3 text-sm">
			<p>Plex: {testResult.plex.ok ? '✅ connected' : `❌ ${testResult.plex.error}`}</p>
			<p>TMDB: {testResult.tmdb.ok ? '✅ connected' : `❌ ${testResult.tmdb.error}`}</p>
		</div>
	{/if}
</div>

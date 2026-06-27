<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();
	// Derived (not a one-time alias) so status/path/backups reflect reloaded data
	// after invalidateAll() — e.g. enabling the manager from the inactive state.
	const km = $derived(data.kometa);

	type Section = 'connections' | 'libraries' | 'settings' | 'raw' | 'backups';
	let section = $state<Section>('connections');
	const sections: { key: Section; label: () => string }[] = [
		{ key: 'connections', label: m.kometa_section_connections },
		{ key: 'libraries', label: m.kometa_section_libraries },
		{ key: 'settings', label: m.kometa_section_settings },
		{ key: 'raw', label: m.kometa_section_raw },
		{ key: 'backups', label: m.kometa_section_backups }
	];

	// ── Header: path + mode (persisted via /api/settings) ──────────────────────
	let configPath = $state(data.config?.kometaConfigPath ?? km.configPath);
	let mode = $state<'merge' | 'own'>(km.mode);
	let savingHeader = $state(false);
	let headerSaved = $state(false);
	let headerError = $state<string | null>(null);

	async function saveHeader() {
		savingHeader = true;
		headerSaved = false;
		headerError = null;
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kometaConfigPath: configPath, kometaConfigMode: mode })
			});
			if (!res.ok) throw new Error(String(res.status));
			headerSaved = true;
			await invalidateAll();
		} catch {
			headerError = m.settings_save_failed();
		} finally {
			savingHeader = false;
		}
	}

	// ── Connections (skip plex/tmdb — their core creds come from PosterPilot) ──
	const connectors = km.connectorCatalog.filter((c) => !c.credsFromPosterPilot);
	const connValues = $state<Record<string, Record<string, string>>>(
		Object.fromEntries(
			connectors.map((c) => {
				const cur = km.connectionValues[c.section] ?? {};
				return [c.section, Object.fromEntries(c.fields.map((f) => [f.key, cur[f.key] ?? '']))];
			})
		)
	);
	function secretSet(section: string, key: string): boolean {
		return (km.connectionSecretsSet[section] ?? []).includes(key);
	}

	// ── Libraries ──────────────────────────────────────────────────────────────
	type LibUI = {
		key: string;
		title: string;
		type: string;
		managed: boolean;
		collections: SvelteSet<string>;
		overlays: SvelteSet<string>;
		operations: Record<string, string>;
		settings: Record<string, string>;
	};
	const libs = $state<LibUI[]>(
		km.availableLibraries.map((l) => {
			const st = km.libraryState[l.title];
			return {
				key: l.key,
				title: l.title,
				type: l.type,
				managed: km.managedLibraries.includes(l.key) || Boolean(st?.hasMetadata),
				collections: new SvelteSet(st?.collections ?? km.defaultCollections[l.key] ?? []),
				overlays: new SvelteSet(st?.overlays ?? []),
				operations: { ...(st?.operations ?? {}) },
				settings: { ...(st?.settings ?? {}) }
			};
		})
	);
	let expanded = $state<string | null>(null);
	function toggleSet(set: SvelteSet<string>, name: string) {
		if (set.has(name)) set.delete(name);
		else set.add(name);
	}

	// ── Global settings (bounded) ──────────────────────────────────────────────
	const globalSettings = $state<Record<string, string>>(
		Object.fromEntries(km.managedSettingDefs.map((d) => [d.id, km.managedSettings[d.id] ?? '']))
	);
	const settingLabel: Record<string, () => string> = {
		asset_directory: m.kometa_setting_asset_directory,
		webhook_error: m.kometa_setting_webhook_error,
		webhook_run_start: m.kometa_setting_webhook_run_start,
		webhook_run_end: m.kometa_setting_webhook_run_end
	};

	function trimmedRecord(r: Record<string, string>): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(r)) if (v.trim() !== '') out[k] = v.trim();
		return out;
	}

	function selection() {
		const libraries: string[] = [];
		const defaults: Record<string, string[]> = {};
		const overlays: Record<string, string[]> = {};
		const operations: Record<string, Record<string, string>> = {};
		const librarySettings: Record<string, Record<string, string>> = {};
		for (const lib of libs) {
			if (!lib.managed) continue;
			libraries.push(lib.key);
			if (lib.collections.size) defaults[lib.key] = [...lib.collections];
			if (lib.overlays.size) overlays[lib.key] = [...lib.overlays];
			const ops = trimmedRecord(lib.operations);
			if (Object.keys(ops).length) operations[lib.key] = ops;
			const ls = trimmedRecord(lib.settings);
			if (Object.keys(ls).length) librarySettings[lib.key] = ls;
		}
		const connections: Record<string, Record<string, string>> = {};
		for (const [s, vals] of Object.entries(connValues)) connections[s] = vals;
		const settings: Record<string, string> = {};
		for (const [id, v] of Object.entries(globalSettings)) if (v.trim()) settings[id] = v.trim();
		return { libraries, defaults, overlays, operations, librarySettings, connections, settings };
	}

	// ── Preview / Sync ─────────────────────────────────────────────────────────
	type Change = { op: string; path: string; after?: string | null };
	type Result = {
		changes: Change[];
		warnings: string[];
		dropped: string[];
		consistency: { library: string; feature: string; requiresConnector: string }[];
		parseError: string | null;
		scaffolded?: boolean;
		backup?: boolean;
	};
	let busy = $state(false);
	let preview = $state<Result | null>(null);
	let error = $state<string | null>(null);
	let done = $state<string | null>(null);

	async function post(path: string): Promise<Result> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(selection())
		});
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as Result;
	}
	async function doPreview() {
		if (busy) return;
		busy = true;
		error = null;
		done = null;
		try {
			preview = await post('/api/kometa/config/preview');
			if (preview.parseError) error = preview.parseError;
		} catch {
			error = m.kometa_request_failed();
		} finally {
			busy = false;
		}
	}
	async function doSync() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const r = await post('/api/kometa/config/sync');
			if (r.parseError) error = r.parseError;
			else {
				done = r.scaffolded ? m.kometa_created() : m.kometa_synced();
				preview = null;
				await invalidateAll();
			}
		} catch {
			error = m.kometa_request_failed();
		} finally {
			busy = false;
		}
	}

	// ── Raw editor ─────────────────────────────────────────────────────────────
	let rawText = $state('');
	let rawLoaded = $state(false);
	let rawBusy = $state(false);
	let rawMsg = $state<string | null>(null);
	async function loadRaw() {
		rawBusy = true;
		try {
			const res = await fetch('/api/kometa/config/raw');
			const body = (await res.json()) as { text: string };
			rawText = body.text;
			rawLoaded = true;
		} finally {
			rawBusy = false;
		}
	}
	async function saveRaw() {
		rawBusy = true;
		rawMsg = null;
		try {
			const res = await fetch('/api/kometa/config/raw', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: rawText })
			});
			const body = (await res.json()) as { ok: boolean; parseError: string | null };
			rawMsg = body.ok ? m.kometa_raw_saved() : (body.parseError ?? m.kometa_request_failed());
			if (body.ok) await invalidateAll();
		} finally {
			rawBusy = false;
		}
	}
	$effect(() => {
		if (section === 'raw' && !rawLoaded) loadRaw();
	});

	// ── Backups ────────────────────────────────────────────────────────────────
	let backups = $state(km.backups);
	let confirmRestore = $state<string | null>(null);
	async function restore(name: string) {
		if (confirmRestore !== name) {
			confirmRestore = name;
			return;
		}
		confirmRestore = null;
		await fetch('/api/kometa/config/restore', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		await invalidateAll();
		backups = data.kometa.backups;
		rawLoaded = false;
	}
	function fmtStamp(stamp: string): string {
		return stamp.replace(/-/g, ':').replace('T', ' ').replace('Z', '');
	}

	const managedCount = $derived(libs.filter((l) => l.managed).length);
	const plexReady = $derived(Boolean(data.config?.plexUrl && data.config?.plexTokenSet));
</script>

<svelte:head><title>{m.kometa_manager_title()} · PosterPilot</title></svelte:head>

<!-- Spotlight hero -->
<div class="relative overflow-hidden rounded-xl border border-neutral-800">
	{#if data.spotlight?.backdropUrl}
		<img
			src={data.spotlight.backdropUrl}
			alt=""
			class="absolute inset-0 h-full w-full object-cover"
		/>
	{:else}
		<div class="absolute inset-0 bg-gradient-to-br from-accent-900/40 to-neutral-950"></div>
	{/if}
	<div
		class="absolute inset-0 bg-gradient-to-r from-neutral-950/95 via-neutral-950/70 to-transparent"
	></div>
	<div class="relative flex min-h-44 flex-col justify-end gap-1 p-6">
		<p class="text-xs tracking-wide text-accent-300 uppercase">{m.kometa_manager_eyebrow()}</p>
		<h1 class="text-2xl font-semibold tracking-tight text-white">{m.kometa_manager_title()}</h1>
		<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-300">
			{#if km.active}
				<span class="font-mono text-neutral-200">{km.resolvedConfigPath}</span>
				<span
					class="badge {km.parseError ? 'badge-error' : km.exists ? 'badge-info' : 'badge-warn'}"
				>
					{km.parseError
						? m.kometa_status_parse_error()
						: km.exists
							? m.kometa_status_ok()
							: m.kometa_status_new()}
				</span>
				<span class="badge badge-muted"
					>{km.mode === 'own' ? m.kometa_mode_own() : m.kometa_mode_merge()}</span
				>
				<span>{m.kometa_status_managed({ count: managedCount })}</span>
			{:else}
				<span class="badge badge-warn">{m.kometa_status_off()}</span>
			{/if}
		</div>
	</div>
</div>

<!-- Path + mode header -->
<div class="surface mt-4 flex flex-wrap items-end gap-3 p-4">
	<div class="min-w-64 flex-1">
		<label for="cfgPath" class="mb-1 block text-sm font-medium">{m.kometa_config_path()}</label>
		<input
			id="cfgPath"
			bind:value={configPath}
			disabled={data.config?.envManaged?.kometaConfigPath}
			placeholder="/config/config.yml"
			class="input w-full font-mono text-xs disabled:opacity-50"
		/>
	</div>
	<div>
		<label for="cfgMode" class="mb-1 block text-sm font-medium">{m.kometa_mode()}</label>
		<select id="cfgMode" bind:value={mode} class="input">
			<option value="merge">{m.kometa_mode_merge()}</option>
			<option value="own">{m.kometa_mode_own()}</option>
		</select>
	</div>
	<button onclick={saveHeader} disabled={savingHeader} class="btn btn-subtle px-4 py-2">
		{savingHeader ? m.settings_saving() : m.settings_save()}
	</button>
	{#if headerSaved}<span class="text-sm text-emerald-400" role="status">{m.settings_saved()}</span
		>{/if}
	{#if headerError}<span class="text-sm text-red-300" role="alert">{headerError}</span>{/if}
</div>

{#if !km.active}
	<p class="mt-3 text-sm text-neutral-400">{m.kometa_setup_hint()}</p>
{:else}
	{#if mode === 'own'}<p class="mt-3 text-xs text-amber-400">{m.kometa_mode_own_warning()}</p>{/if}
	{#if !plexReady}<p class="mt-2 text-xs text-amber-400">{m.kometa_missing_plex_creds()}</p>{/if}

	<!-- Section tabs -->
	<div class="mt-5 flex flex-wrap gap-1 border-b border-neutral-800">
		{#each sections as s (s.key)}
			<button
				onclick={() => (section = s.key)}
				class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition {section === s.key
					? 'border-accent-500 text-accent-200'
					: 'border-transparent text-neutral-400 hover:text-neutral-100'}"
			>
				{s.label()}
			</button>
		{/each}
	</div>

	<div class="mt-6 space-y-5">
		{#if section === 'connections'}
			<p class="text-xs text-neutral-400">{m.kometa_plex_only_note()}</p>
			<p class="text-xs text-amber-400">{m.kometa_secrets_note()}</p>
			{#each connectors as c (c.section)}
				{@const cdoc = km.connectorDocs[c.section]}
				<details class="surface p-4">
					<summary class="flex cursor-pointer items-center justify-between text-sm font-medium">
						<span>{c.label}</span>
						{#if cdoc?.docUrl}
							<a
								href={cdoc.docUrl}
								target="_blank"
								rel="noopener"
								onclick={(e) => e.stopPropagation()}
								class="text-xs font-normal text-accent-300 hover:underline">docs ↗</a
							>
						{/if}
					</summary>
					{#if cdoc?.description}
						<p class="mt-2 text-xs text-neutral-400">{cdoc.description}</p>
					{/if}
					<div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
						{#each c.fields as f (f.key)}
							{@const help = cdoc?.fields[f.key] ?? f.note ?? ''}
							<div>
								<label
									for="conn-{c.section}-{f.key}"
									class="mb-1 block text-xs text-neutral-300"
									title={help}
								>
									{f.key}{#if f.type === 'secret'}<span class="text-amber-400"> ·</span>{/if}
								</label>
								<input
									id="conn-{c.section}-{f.key}"
									type={f.type === 'secret' ? 'password' : 'text'}
									bind:value={connValues[c.section][f.key]}
									placeholder={f.type === 'secret' && secretSet(c.section, f.key)
										? m.settings_secret_placeholder_set()
										: help}
									class="input w-full text-sm"
								/>
							</div>
						{/each}
					</div>
				</details>
			{/each}
		{:else if section === 'libraries'}
			{#if libs.length === 0}
				<p class="text-xs text-neutral-400">{m.kometa_no_libraries()}</p>
			{/if}
			{#each libs as lib (lib.key)}
				<div class="surface p-4">
					<div class="flex items-center justify-between gap-3">
						<label class="flex items-center gap-2 text-sm font-medium">
							<input type="checkbox" bind:checked={lib.managed} />
							{lib.title}
							<span class="text-xs text-neutral-400">({lib.type})</span>
						</label>
						<button
							type="button"
							onclick={() => (expanded = expanded === lib.key ? null : lib.key)}
							class="btn btn-ghost px-2 py-0.5 text-xs"
							disabled={!lib.managed}
						>
							{expanded === lib.key ? m.kometa_collapse() : m.kometa_expand()}
						</button>
					</div>
					{#if lib.managed && expanded === lib.key}
						<div class="mt-4 space-y-4 border-t border-neutral-800 pt-4">
							<div>
								<p class="mb-2 text-xs font-medium text-neutral-300">
									{m.kometa_section_collections()}
								</p>
								{#each km.catalog as g (g.id)}
									<div class="mb-2">
										<p class="mb-1 flex items-center gap-2 text-[11px] text-neutral-500">
											<span>{g.label}</span>
											{#if g.docUrl}<a
													href={g.docUrl}
													target="_blank"
													rel="noopener"
													class="text-accent-300 hover:underline">↗</a
												>{/if}
										</p>
										<div class="flex flex-wrap gap-x-4 gap-y-1">
											{#each g.collections as c (c.name)}
												<label
													class="flex items-center gap-1.5 text-xs text-neutral-300"
													title={c.description}
												>
													<input
														type="checkbox"
														checked={lib.collections.has(c.name)}
														onchange={() => toggleSet(lib.collections, c.name)}
													/>
													{c.name}
												</label>
											{/each}
										</div>
									</div>
								{/each}
							</div>
							<div>
								<p class="mb-2 text-xs font-medium text-neutral-300">
									{m.kometa_section_overlays()}
								</p>
								{#each km.overlayCatalog as g (g.id)}
									<div class="mb-2">
										<p class="mb-1 flex items-center gap-2 text-[11px] text-neutral-500">
											<span>{g.label}</span>
											{#if g.docUrl}<a
													href={g.docUrl}
													target="_blank"
													rel="noopener"
													class="text-accent-300 hover:underline">↗</a
												>{/if}
										</p>
										<div class="flex flex-wrap gap-x-4 gap-y-1">
											{#each g.overlays as o (o.name)}
												<label
													class="flex items-center gap-1.5 text-xs text-neutral-300"
													title={o.description}
												>
													<input
														type="checkbox"
														checked={lib.overlays.has(o.name)}
														onchange={() => toggleSet(lib.overlays, o.name)}
													/>
													{o.name}
												</label>
											{/each}
										</div>
									</div>
								{/each}
							</div>
							<div>
								<p class="mb-2 text-xs font-medium text-neutral-300">
									{m.kometa_section_operations()}
								</p>
								<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
									{#each km.operationCatalog as op (op.key)}
										<div class="flex items-center gap-2" title={op.description}>
											{#if op.type === 'bool'}
												<label class="flex items-center gap-1.5 text-xs text-neutral-300">
													<input
														type="checkbox"
														checked={lib.operations[op.key] === 'true'}
														onchange={(e) =>
															(lib.operations[op.key] = (e.currentTarget as HTMLInputElement)
																.checked
																? 'true'
																: '')}
													/>
													{op.label}
												</label>
											{:else if op.enumValues}
												<label class="flex flex-1 items-center gap-2 text-xs text-neutral-300">
													<span class="w-44 shrink-0 truncate">{op.label}</span>
													<select
														bind:value={lib.operations[op.key]}
														class="input w-full py-1 text-xs"
													>
														<option value="">—</option>
														{#each op.enumValues as v (v)}<option value={v}>{v}</option>{/each}
													</select>
												</label>
											{:else}
												<label class="flex flex-1 items-center gap-2 text-xs text-neutral-300">
													<span class="w-44 shrink-0 truncate">{op.label}</span>
													<input
														bind:value={lib.operations[op.key]}
														placeholder={op.type}
														class="input w-full py-1 text-xs"
													/>
												</label>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		{:else if section === 'settings'}
			<p class="text-xs text-neutral-400">{m.kometa_settings_hint()}</p>
			<div class="surface space-y-3 p-4">
				{#each km.managedSettingDefs as def (def.id)}
					<div>
						<label for="gset-{def.id}" class="mb-1 block text-sm text-neutral-300">
							{settingLabel[def.id]?.() ?? def.id}
						</label>
						<input
							id="gset-{def.id}"
							bind:value={globalSettings[def.id]}
							placeholder={def.placeholder ?? ''}
							class="input w-full"
						/>
					</div>
				{/each}
			</div>
		{:else if section === 'raw'}
			<p class="text-xs text-neutral-400">{m.kometa_raw_hint()}</p>
			<textarea
				bind:value={rawText}
				spellcheck="false"
				class="input h-[28rem] w-full font-mono text-xs"
				placeholder={rawBusy ? '…' : ''}></textarea>
			<div class="flex items-center gap-3">
				<button onclick={saveRaw} disabled={rawBusy} class="btn btn-accent px-4 py-2">
					{rawBusy ? m.settings_saving() : m.kometa_raw_save()}
				</button>
				<button onclick={loadRaw} disabled={rawBusy} class="btn btn-ghost px-3 py-2">
					{m.kometa_raw_reload()}
				</button>
				{#if rawMsg}<span class="text-sm text-neutral-300">{rawMsg}</span>{/if}
			</div>
		{:else if section === 'backups'}
			{#if backups.length === 0}
				<p class="text-xs text-neutral-400">{m.kometa_backups_none()}</p>
			{:else}
				<div class="surface divide-y divide-neutral-800/60">
					{#each backups as b (b.name)}
						<div class="flex items-center justify-between gap-3 px-4 py-2 text-sm">
							<span class="font-mono text-xs text-neutral-300">{fmtStamp(b.stamp)}</span>
							<button
								type="button"
								onclick={() => restore(b.name)}
								onblur={() => (confirmRestore = null)}
								class="btn {confirmRestore === b.name
									? 'bg-red-900/50 text-red-300 hover:bg-red-900/70'
									: 'btn-ghost'} px-3 py-1 text-xs"
							>
								{confirmRestore === b.name ? m.kometa_restore_confirm() : m.kometa_restore()}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Action bar (preview/sync) — not on raw/backups -->
	{#if section !== 'raw' && section !== 'backups'}
		<div class="surface mt-6 flex items-center gap-3 p-4">
			<button onclick={doPreview} disabled={busy} class="btn btn-subtle px-4 py-2">
				{busy ? m.kometa_previewing() : m.kometa_preview()}
			</button>
			<button
				onclick={doSync}
				disabled={busy || Boolean(km.parseError)}
				class="btn btn-accent px-4 py-2"
			>
				{busy ? m.kometa_syncing() : m.kometa_sync()}
			</button>
			{#if done}<span class="text-sm text-emerald-400" role="status">{done}</span>{/if}
			{#if error}<span class="text-sm text-red-300" role="alert">{error}</span>{/if}
		</div>

		{#if preview}
			<div class="surface mt-3 space-y-2 p-3 text-sm">
				{#each preview.consistency as w (w.library + w.feature)}
					<p class="text-amber-400">
						{m.kometa_consistency_warning({
							feature: w.feature,
							connector: w.requiresConnector,
							library: w.library
						})}
					</p>
				{/each}
				{#if preview.warnings.length}
					<p class="text-amber-400">
						{m.kometa_warnings({ sections: preview.warnings.join(', ') })}
					</p>
				{/if}
				{#if preview.dropped.length}
					<p class="text-red-300">{m.kometa_dropped({ keys: preview.dropped.join(', ') })}</p>
				{/if}
				{#if preview.changes.length === 0}
					<p class="text-neutral-400">{m.kometa_preview_none()}</p>
				{:else}
					<ul class="space-y-1">
						{#each preview.changes as c, i (i)}
							<li class="flex items-baseline gap-2 font-mono text-xs">
								<span
									class={c.op === 'remove'
										? 'text-red-300'
										: c.op === 'add'
											? 'text-emerald-300'
											: 'text-amber-300'}>{c.op}</span
								>
								<span class="text-neutral-300">{c.path}</span>
								{#if c.after != null}<span class="text-neutral-500">→ {c.after}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/if}
{/if}

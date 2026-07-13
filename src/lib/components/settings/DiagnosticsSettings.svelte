<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	type ComponentType =
		| 'server'
		| 'tmdb'
		| 'artwork_provider'
		| 'kometa'
		| 'data_path'
		| 'backup_path';
	type Health = 'healthy' | 'degraded' | 'unavailable' | 'disabled' | 'unknown';
	type Credential = 'not_applicable' | 'valid' | 'missing' | 'rejected' | 'unknown';
	type Timestamp = string | Date | null;

	type StatusRow = {
		serverInstanceId: string | null;
		componentType: ComponentType;
		componentKey: string;
		status: Health;
		credentialStatus: Credential;
		latencyMs: number | null;
		lastAttemptAt: Timestamp;
		lastSuccessAt: Timestamp;
		errorCode: string | null;
		capabilities: Record<string, unknown> | null;
	};

	type ComponentDefinition = {
		serverInstanceId: string | null;
		componentType: ComponentType;
		componentKey: string;
	};

	type ServerSummary = { id: string; name: string };
	type RunRow = { id: string; status: string; startedAt: Timestamp };

	let {
		initial,
		servers,
		locale
	}: {
		initial: {
			latest: StatusRow[];
			history: { run: RunRow; results: unknown[] }[];
		};
		servers: ServerSummary[];
		locale: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	let statuses = $state<StatusRow[]>(initial.latest);
	// svelte-ignore state_referenced_locally
	let history = $state(initial.history);
	let pendingKeys = $state<string[]>([]);
	let running = $state(false);
	let runError = $state(false);
	let liveMessage = $state('');
	let exportOpen = $state(false);
	let includeTitles = $state(false);
	let exporting = $state(false);
	let exportError = $state(false);

	function rowKey(row: ComponentDefinition): string {
		return `${row.serverInstanceId ?? 'global'}\u0000${row.componentType}\u0000${row.componentKey}`;
	}

	const components = $derived.by(() => {
		const rows: ComponentDefinition[] = [
			...servers.map((server) => ({
				serverInstanceId: server.id,
				componentType: 'server' as const,
				componentKey: server.id
			})),
			{ serverInstanceId: null, componentType: 'tmdb', componentKey: 'tmdb' },
			...['mediux', 'fanarttv', 'theposterdb', 'tmdb'].map((componentKey) => ({
				serverInstanceId: null,
				componentType: 'artwork_provider' as const,
				componentKey
			})),
			{ serverInstanceId: null, componentType: 'kometa', componentKey: 'assets' },
			{ serverInstanceId: null, componentType: 'kometa', componentKey: 'config' },
			{ serverInstanceId: null, componentType: 'data_path', componentKey: 'application_data' },
			{
				serverInstanceId: null,
				componentType: 'backup_path',
				componentKey: 'application_backups'
			}
		];
		const known = new Set(rows.map(rowKey));
		for (const status of statuses) {
			if (!known.has(rowKey(status))) rows.push(status);
		}
		return rows;
	});

	function statusFor(component: ComponentDefinition): StatusRow | null {
		const key = rowKey(component);
		return statuses.find((status) => rowKey(status) === key) ?? null;
	}

	function serverName(id: string): string {
		return servers.find((server) => server.id === id)?.name ?? m.diagnostics_component_server();
	}

	function componentLabel(component: ComponentDefinition): string {
		if (component.componentType === 'server') return serverName(component.componentKey);
		if (component.componentType === 'tmdb') return m.diagnostics_component_tmdb();
		if (component.componentType === 'kometa') {
			return component.componentKey === 'config'
				? m.diagnostics_component_kometa_config()
				: m.diagnostics_component_kometa_assets();
		}
		if (component.componentType === 'data_path') return m.diagnostics_component_data_path();
		if (component.componentType === 'backup_path') return m.diagnostics_component_backup_path();
		switch (component.componentKey) {
			case 'mediux':
				return m.diagnostics_component_mediux();
			case 'fanarttv':
				return m.diagnostics_component_fanart();
			case 'theposterdb':
				return m.diagnostics_component_theposterdb();
			default:
				return m.diagnostics_component_tmdb_artwork();
		}
	}

	function componentTypeLabel(type: ComponentType): string {
		if (type === 'server') return m.diagnostics_type_server();
		if (type === 'tmdb') return m.diagnostics_type_metadata();
		if (type === 'artwork_provider') return m.diagnostics_type_provider();
		return m.diagnostics_type_path();
	}

	function healthLabel(status: Health): string {
		switch (status) {
			case 'healthy':
				return m.diagnostics_status_healthy();
			case 'degraded':
				return m.diagnostics_status_degraded();
			case 'unavailable':
				return m.diagnostics_status_unavailable();
			case 'disabled':
				return m.diagnostics_status_disabled();
			default:
				return m.diagnostics_status_unknown();
		}
	}

	function credentialLabel(status: Credential): string {
		switch (status) {
			case 'valid':
				return m.diagnostics_credential_valid();
			case 'missing':
				return m.diagnostics_credential_missing();
			case 'rejected':
				return m.diagnostics_credential_rejected();
			case 'not_applicable':
				return m.diagnostics_credential_not_applicable();
			default:
				return m.diagnostics_credential_unknown();
		}
	}

	function runStatusLabel(status: string): string {
		if (status === 'completed') return m.diagnostics_run_status_completed();
		if (status === 'partial') return m.diagnostics_run_status_partial();
		if (status === 'failed') return m.diagnostics_run_status_failed();
		return m.diagnostics_run_status_running();
	}

	function badgeClass(status: Health): string {
		if (status === 'healthy') return 'badge badge-changed';
		if (status === 'degraded') return 'badge badge-warn';
		if (status === 'unavailable') return 'badge badge-error';
		return 'badge badge-info';
	}

	function healthSymbol(status: Health): string {
		if (status === 'healthy') return '✓';
		if (status === 'degraded') return '!';
		if (status === 'unavailable') return '×';
		if (status === 'disabled') return '–';
		return '?';
	}

	function dateTime(value: Timestamp): string {
		if (!value) return m.diagnostics_never_checked();
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? m.diagnostics_never_checked()
			: date.toLocaleString(locale);
	}

	function correctiveHint(code: string | null): string | null {
		if (!code) return null;
		switch (code) {
			case 'credential_missing':
				return m.diagnostics_hint_credential_missing();
			case 'credential_rejected':
				return m.diagnostics_hint_credential_rejected();
			case 'timeout':
				return m.diagnostics_hint_timeout();
			case 'network_unavailable':
				return m.diagnostics_hint_network();
			case 'path_missing':
				return m.diagnostics_hint_path_missing();
			case 'path_type_mismatch':
				return m.diagnostics_hint_path_type();
			case 'path_unreadable':
				return m.diagnostics_hint_path_unreadable();
			case 'path_unwritable':
				return m.diagnostics_hint_path_unwritable();
			default:
				return m.diagnostics_hint_generic();
		}
	}

	const capabilityLabels: Record<string, () => string> = {
		posterWrite: m.diagnostics_cap_poster,
		backgroundWrite: m.diagnostics_cap_background,
		seasonWrite: m.diagnostics_cap_season,
		episodeWrite: m.diagnostics_cap_episode,
		fieldLock: m.diagnostics_cap_field_lock,
		currentImageRetrieval: m.diagnostics_cap_current_image,
		artworkDelete: m.diagnostics_cap_delete
	};

	function capabilityValue(value: unknown): string {
		if (value === true || value === 'supported') return m.diagnostics_supported();
		if (value === false || value === 'unsupported') return m.diagnostics_unsupported();
		return m.diagnostics_status_unknown();
	}

	function pathChecks(status: StatusRow | null): Record<string, unknown> | null {
		const value = status?.capabilities?.pathChecks;
		return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
	}

	function applyResult(result: Record<string, unknown>) {
		const path =
			typeof result.pathChecks === 'object' && result.pathChecks !== null
				? { pathChecks: result.pathChecks }
				: null;
		const normalized: StatusRow = {
			serverInstanceId: (result.serverInstanceId as string | null) ?? null,
			componentType: result.componentType as ComponentType,
			componentKey: String(result.componentKey),
			status: result.status as Health,
			credentialStatus: result.credentialStatus as Credential,
			latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
			lastAttemptAt: result.checkedAt as Timestamp,
			lastSuccessAt: result.lastSuccessAt as Timestamp,
			errorCode: typeof result.errorCode === 'string' ? result.errorCode : null,
			capabilities:
				typeof result.capabilities === 'object' && result.capabilities !== null
					? (result.capabilities as Record<string, unknown>)
					: path
		};
		const key = rowKey(normalized);
		statuses = [...statuses.filter((status) => rowKey(status) !== key), normalized];
		pendingKeys = pendingKeys.filter((pending) => pending !== key);
		liveMessage = m.diagnostics_component_finished({
			component: componentLabel(normalized),
			status: healthLabel(normalized.status)
		});
	}

	async function runChecks() {
		if (running) return;
		running = true;
		runError = false;
		pendingKeys = components.map(rowKey);
		liveMessage = m.diagnostics_running();
		try {
			const response = await fetch('/api/diagnostics', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
				body: JSON.stringify({ stream: true })
			});
			if (!response.ok || !response.body) throw new Error('diagnostics_failed');
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffered = '';
			while (true) {
				const { done, value } = await reader.read();
				buffered += decoder.decode(value, { stream: !done });
				const lines = buffered.split('\n');
				buffered = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.trim()) continue;
					const event = JSON.parse(line) as {
						type: string;
						result?: Record<string, unknown>;
						status?: string;
					};
					if (event.type === 'result' && event.result) applyResult(event.result);
					if (event.type === 'error') throw new Error('diagnostics_failed');
					if (event.type === 'complete') {
						liveMessage =
							event.status === 'completed'
								? m.diagnostics_run_complete()
								: m.diagnostics_run_partial();
					}
				}
				if (done) break;
			}
			const refreshed = await fetch('/api/diagnostics?limit=5');
			if (refreshed.ok) {
				const body = (await refreshed.json()) as typeof initial;
				history = body.history;
			}
		} catch {
			runError = true;
			liveMessage = m.diagnostics_run_failed();
		} finally {
			pendingKeys = [];
			running = false;
		}
	}

	async function exportSupportBundle() {
		if (exporting) return;
		exporting = true;
		exportError = false;
		try {
			const response = await fetch('/api/diagnostics/support-bundle', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirmed: true, includeTitles })
			});
			if (!response.ok) throw new Error('support_bundle_failed');
			const blob = await response.blob();
			const disposition = response.headers.get('content-disposition') ?? '';
			const filename =
				/filename="([A-Za-z0-9._-]+)"/u.exec(disposition)?.[1] ?? 'posterpilot-support.tar';
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 0);
			exportOpen = false;
			includeTitles = false;
			liveMessage = m.diagnostics_support_ready();
		} catch {
			exportError = true;
		} finally {
			exporting = false;
		}
	}
</script>

<div class="space-y-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold">{m.diagnostics_title()}</h2>
			<p class="mt-1 max-w-2xl text-sm text-neutral-400">{m.diagnostics_intro()}</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="btn btn-ghost"
				aria-expanded={exportOpen}
				aria-controls="diagnostics-support-bundle"
				onclick={() => {
					exportOpen = !exportOpen;
					exportError = false;
				}}
			>
				{m.diagnostics_support_export()}
			</button>
			<button type="button" class="btn btn-accent" disabled={running} onclick={runChecks}>
				{running ? m.diagnostics_running() : m.diagnostics_run()}
			</button>
		</div>
	</div>

	<p class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</p>
	{#if exportOpen}
		<div
			id="diagnostics-support-bundle"
			role="region"
			class="surface border-accent-900/60 p-4"
			aria-labelledby="support-bundle-title"
		>
			<h3 id="support-bundle-title" class="text-sm font-semibold">
				{m.diagnostics_support_title()}
			</h3>
			<p class="mt-1 text-xs text-neutral-400">{m.diagnostics_support_intro()}</p>
			<label class="mt-3 flex items-start gap-2 text-sm text-neutral-300">
				<input type="checkbox" class="mt-0.5" bind:checked={includeTitles} />
				<span>
					<span class="block">{m.diagnostics_support_include_titles()}</span>
					<span class="mt-0.5 block text-xs text-amber-300">
						{m.diagnostics_support_titles_warning()}
					</span>
				</span>
			</label>
			{#if exportError}
				<p class="mt-3 text-sm text-red-300" role="alert">{m.diagnostics_support_failed()}</p>
			{/if}
			<div class="mt-4 flex gap-2">
				<button
					type="button"
					class="btn btn-accent"
					disabled={exporting}
					onclick={exportSupportBundle}
				>
					{exporting ? m.diagnostics_support_exporting() : m.diagnostics_support_confirm()}
				</button>
				<button
					type="button"
					class="btn btn-ghost"
					disabled={exporting}
					onclick={() => (exportOpen = false)}
				>
					{m.diagnostics_support_cancel()}
				</button>
			</div>
		</div>
	{/if}
	{#if runError}
		<p class="surface border-red-900/60 p-3 text-sm text-red-300" role="alert">
			{m.diagnostics_run_failed()}
		</p>
	{/if}

	<div class="grid gap-3 md:grid-cols-2">
		{#each components as component (rowKey(component))}
			{@const status = statusFor(component)}
			{@const pending = pendingKeys.includes(rowKey(component))}
			{@const health = status?.status ?? 'unknown'}
			{@const path = pathChecks(status)}
			<article class="surface p-4" aria-busy={pending}>
				<div class="flex items-start justify-between gap-3">
					<div>
						<h3 class="font-medium text-neutral-100">{componentLabel(component)}</h3>
						<p class="mt-0.5 text-xs text-neutral-500">
							{componentTypeLabel(component.componentType)}
						</p>
					</div>
					{#if pending}
						<span class="badge badge-info" role="status">{m.diagnostics_progress()}</span>
					{:else}
						<span class={badgeClass(health)}>
							<span class="mr-1" aria-hidden="true">{healthSymbol(health)}</span>
							{healthLabel(health)}
						</span>
					{/if}
				</div>

				<dl class="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
					<div>
						<dt class="text-neutral-500">{m.diagnostics_credential_label()}</dt>
						<dd class="mt-0.5 text-neutral-300">
							{credentialLabel(status?.credentialStatus ?? 'unknown')}
						</dd>
					</div>
					<div>
						<dt class="text-neutral-500">{m.diagnostics_latency()}</dt>
						<dd class="mt-0.5 text-neutral-300">
							{status?.latencyMs == null
								? '—'
								: m.diagnostics_latency_value({ value: status.latencyMs })}
						</dd>
					</div>
					<div>
						<dt class="text-neutral-500">{m.diagnostics_last_check()}</dt>
						<dd class="mt-0.5 text-neutral-300">{dateTime(status?.lastAttemptAt ?? null)}</dd>
					</div>
					<div>
						<dt class="text-neutral-500">{m.diagnostics_last_success()}</dt>
						<dd class="mt-0.5 text-neutral-300">{dateTime(status?.lastSuccessAt ?? null)}</dd>
					</div>
				</dl>

				{#if correctiveHint(status?.errorCode ?? null)}
					<p class="mt-3 rounded-md bg-neutral-950/70 px-3 py-2 text-xs text-neutral-300">
						{correctiveHint(status?.errorCode ?? null)}
					</p>
				{/if}

				{#if path}
					<dl class="mt-3 space-y-1 border-t border-neutral-800 pt-3 text-xs">
						<div class="flex justify-between gap-3">
							<dt class="text-neutral-500">{m.diagnostics_path()}</dt>
							<dd class="truncate font-mono text-neutral-300" title={String(path.path ?? '')}>
								{String(path.path ?? '—')}
							</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-neutral-500">{m.diagnostics_readable()}</dt>
							<dd>{path.readable ? m.diagnostics_yes() : m.diagnostics_no()}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-neutral-500">{m.diagnostics_writable()}</dt>
							<dd>{path.writable ? m.diagnostics_yes() : m.diagnostics_no()}</dd>
						</div>
					</dl>
				{/if}

				{#if status?.capabilities && component.componentType === 'server'}
					<details class="mt-3 border-t border-neutral-800 pt-3 text-xs">
						<summary class="cursor-pointer text-neutral-300">{m.diagnostics_capabilities()}</summary
						>
						<dl class="mt-2 space-y-1">
							{#each Object.entries(capabilityLabels) as [key, label] (key)}
								<div class="flex justify-between gap-3">
									<dt class="text-neutral-500">{label()}</dt>
									<dd>{capabilityValue(status.capabilities[key])}</dd>
								</div>
							{/each}
						</dl>
					</details>
				{/if}
			</article>
		{/each}
	</div>

	<div>
		<h3 class="section-title">{m.diagnostics_history()}</h3>
		{#if history.length === 0}
			<p class="text-sm text-neutral-400">{m.diagnostics_no_history()}</p>
		{:else}
			<ul class="surface divide-y divide-neutral-800 text-sm">
				{#each history as entry (entry.run.id)}
					<li class="flex items-center justify-between gap-3 px-4 py-3">
						<span class="text-neutral-300">{dateTime(entry.run.startedAt)}</span>
						<span class="text-xs text-neutral-400">{runStatusLabel(entry.run.status)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

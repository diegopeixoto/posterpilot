<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { readLocaleNeutralApiError } from '$lib/i18n/api-errors';
	import ServerPurgeDialog from './ServerPurgeDialog.svelte';

	type ServerType = 'plex' | 'jellyfin' | 'emby';
	type ServerSummary = {
		id: string;
		name: string;
		type: ServerType;
		baseUrl: string | null;
		credentialSet: boolean;
		enabled: boolean;
		protected: boolean;
		connectionStatus: 'unknown' | 'healthy' | 'unauthorized' | 'unreachable' | 'disabled';
		lastTestedAt: string | Date | null;
		disconnectedAt: string | Date | null;
	};
	type ServerPurgeImpact = {
		items: number;
		candidates: number;
		jobs: number;
		jobAttempts: number;
		revisions: number;
		revisionGroups: number;
		snapshots: number;
		snapshotFiles: number;
		collections: number;
		collectionMemberships: number;
		schedules: number;
		scheduleOccurrences: number;
		activeMutatingJobs: number;
		totalRecords: number;
	};
	type ServerPurgePreview = {
		planId: string;
		digest: string;
		expiresAt: string;
		server: { id: string; name: string; type: ServerType; disconnectedAt: string };
		impact: ServerPurgeImpact;
		blocked: boolean;
		backupRecommended: true;
	};

	let {
		initial,
		locale
	}: {
		initial: { servers: ServerSummary[]; activeServerId: string | null };
		locale: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	let servers = $state<ServerSummary[]>([...initial.servers]);
	// svelte-ignore state_referenced_locally
	let activeServerId = $state<string | null>(initial.activeServerId);
	// svelte-ignore state_referenced_locally
	let addOpen = $state(initial.servers.length === 0);
	let editingId = $state<string | null>(null);
	let confirmingDisconnectId = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let errorCode = $state<string | null>(null);
	let errorReference = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let testResult = $state<{ ok: boolean; status: string; serverName?: string } | null>(null);
	let purgePreview = $state<ServerPurgePreview | null>(null);

	let addName = $state('');
	let addType = $state<ServerType>('plex');
	let addBaseUrl = $state('');
	let addCredential = $state('');
	let editName = $state('');
	let editType = $state<ServerType>('plex');
	let editBaseUrl = $state('');
	let editCredential = $state('');
	let addNameInput: HTMLInputElement | null = $state(null);
	let editNameInput: HTMLInputElement | null = $state(null);

	function typeLabel(type: ServerType): string {
		return type === 'jellyfin' ? 'Jellyfin' : type === 'emby' ? 'Emby' : 'Plex';
	}

	function statusLabel(status: ServerSummary['connectionStatus']): string {
		switch (status) {
			case 'healthy':
				return m.server_manager_status_healthy();
			case 'unauthorized':
				return m.server_manager_status_unauthorized();
			case 'unreachable':
				return m.server_manager_status_unreachable();
			case 'disabled':
				return m.server_manager_status_disabled();
			default:
				return m.server_manager_status_unknown();
		}
	}

	function statusClass(status: ServerSummary['connectionStatus']): string {
		return status === 'healthy'
			? 'badge badge-success'
			: status === 'unauthorized' || status === 'unreachable'
				? 'badge badge-error'
				: status === 'disabled'
					? 'badge badge-muted'
					: 'badge badge-warn';
	}

	function errorMessage(code: string | null): string | null {
		if (!code) return null;
		switch (code) {
			case 'invalid_request':
			case 'invalid_name':
				return m.server_manager_error_invalid_name();
			case 'invalid_server_type':
				return m.server_manager_error_invalid_type();
			case 'invalid_base_url':
				return m.server_manager_error_invalid_url();
			case 'credential_required':
				return m.server_manager_error_credential_required();
			case 'duplicate_name':
				return m.server_manager_error_duplicate_name();
			case 'connection_unauthorized':
				return m.server_manager_error_unauthorized();
			case 'connection_unreachable':
				return m.server_manager_error_unreachable();
			case 'server_instance_disabled':
				return m.server_manager_error_disabled();
			case 'server_instance_disconnected':
				return m.server_manager_error_disconnected();
			case 'server_instance_protected':
				return m.server_manager_error_protected();
			case 'server_purge_requires_disconnect':
				return m.server_purge_error_disconnect_first();
			case 'server_purge_active_jobs':
				return m.server_purge_error_active_jobs();
			case 'server_purge_stale':
			case 'server_purge_invalid_plan':
			case 'server_purge_scope_mismatch':
			case 'plan_not_found':
			case 'plan_expired':
			case 'plan_consumed':
			case 'plan_digest_mismatch':
			case 'plan_payload_mismatch':
				return m.server_purge_error_stale();
			default:
				return m.api_error_generic();
		}
	}

	function formatDate(value: string | Date | null): string {
		return value ? new Date(value).toLocaleString(locale) : m.server_manager_never_tested();
	}

	function resetFeedback() {
		errorCode = null;
		errorReference = null;
		notice = null;
		testResult = null;
	}

	async function api(
		path: string,
		init: Parameters<typeof fetch>[1] = undefined
	): Promise<Record<string, unknown>> {
		const response = await fetch(path, init);
		const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
		if (!response.ok) {
			const parsed = readLocaleNeutralApiError(body);
			errorCode = parsed.code;
			errorReference = parsed.correlationId;
			throw new Error('server_management_request_failed');
		}
		return body;
	}

	async function refresh() {
		const response = await fetch('/api/servers');
		if (!response.ok) throw new Error('server_management_refresh_failed');
		const body = (await response.json()) as {
			servers: ServerSummary[];
			activeServerId: string | null;
		};
		servers = body.servers;
		activeServerId = body.activeServerId;
	}

	async function finish(message: string) {
		await refresh();
		notice = message;
		await invalidateAll();
	}

	async function testCandidate() {
		if (busy) return;
		resetFeedback();
		busy = 'test-new';
		try {
			const body = await api('/api/servers/test', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: addType, baseUrl: addBaseUrl, credential: addCredential })
			});
			testResult = body.result as typeof testResult;
			if (!testResult?.ok) {
				errorCode =
					testResult?.status === 'unauthorized'
						? 'connection_unauthorized'
						: 'connection_unreachable';
			}
		} catch {
			// The structured error is already captured by `api`.
		} finally {
			busy = null;
		}
	}

	async function addServer() {
		if (busy) return;
		resetFeedback();
		busy = 'add';
		try {
			await api('/api/servers', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: addName,
					type: addType,
					baseUrl: addBaseUrl,
					credential: addCredential
				})
			});
			addName = '';
			addBaseUrl = '';
			addCredential = '';
			addOpen = false;
			await finish(m.server_manager_added());
		} catch {
			// The structured error is already captured by `api`.
		} finally {
			busy = null;
		}
	}

	async function toggleAdd() {
		addOpen = !addOpen;
		resetFeedback();
		if (addOpen) {
			await tick();
			addNameInput?.focus();
		}
	}

	async function beginEdit(server: ServerSummary) {
		resetFeedback();
		editingId = server.id;
		editName = server.name;
		editType = server.type;
		editBaseUrl = server.baseUrl ?? '';
		editCredential = '';
		await tick();
		editNameInput?.focus();
	}

	function closeEdit(id: string) {
		editingId = null;
		requestAnimationFrame(() => document.getElementById(`server-edit-${id}`)?.focus());
	}

	async function saveEdit(id: string) {
		if (busy) return;
		resetFeedback();
		busy = `edit:${id}`;
		try {
			await api(`/api/servers/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: editName,
					type: editType,
					baseUrl: editBaseUrl,
					...(editCredential ? { credential: editCredential } : {})
				})
			});
			editingId = null;
			editCredential = '';
			await finish(m.server_manager_updated());
		} catch {
			// The structured error is already captured by `api`.
		} finally {
			busy = null;
		}
	}

	async function serverAction(
		server: ServerSummary,
		action: 'test' | 'activate' | 'enable' | 'disable' | 'disconnect'
	) {
		if (busy) return;
		resetFeedback();
		busy = `${action}:${server.id}`;
		try {
			if (action === 'test') {
				const body = await api('/api/servers/test', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id: server.id })
				});
				testResult = body.result as typeof testResult;
				if (!testResult?.ok) {
					errorCode =
						testResult?.status === 'unauthorized'
							? 'connection_unauthorized'
							: 'connection_unreachable';
				} else {
					await finish(m.server_manager_test_ok());
				}
				return;
			}

			await api(`/api/servers/${encodeURIComponent(server.id)}/${action}`, {
				method: 'POST',
				...(action === 'disconnect'
					? {
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ confirm: true })
						}
					: {})
			});
			confirmingDisconnectId = null;
			await finish(
				action === 'activate'
					? m.server_manager_activated()
					: action === 'enable'
						? m.server_manager_enabled()
						: action === 'disable'
							? m.server_manager_disabled()
							: m.server_manager_disconnected()
			);
		} catch {
			// The structured error is already captured by `api`.
		} finally {
			busy = null;
		}
	}

	async function previewPurge(server: ServerSummary) {
		if (busy || !server.disconnectedAt) return;
		resetFeedback();
		busy = `purge-preview:${server.id}`;
		try {
			const body = await api(`/api/servers/${encodeURIComponent(server.id)}/purge`, {
				method: 'POST'
			});
			const preview = body.preview as ServerPurgePreview | undefined;
			if (!preview || preview.server.id !== server.id) throw new Error('invalid_purge_preview');
			purgePreview = preview;
		} catch {
			// The structured error is already captured by `api` when the request failed.
			if (!errorCode) errorCode = 'server_purge_invalid_plan';
		} finally {
			busy = null;
		}
	}

	function cancelPurge(): void {
		if (busy) return;
		purgePreview = null;
	}

	async function confirmPurge() {
		if (busy || !purgePreview || purgePreview.blocked) return;
		const frozen = purgePreview;
		resetFeedback();
		busy = `purge-confirm:${frozen.server.id}`;
		try {
			const body = await api(`/api/servers/${encodeURIComponent(frozen.server.id)}/purge`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					confirm: true,
					planId: frozen.planId,
					digest: frozen.digest
				})
			});
			const result = body.result as
				| { serverInstanceId?: string; snapshotFilesReleaseFailed?: number }
				| undefined;
			if (result?.serverInstanceId !== frozen.server.id) throw new Error('invalid_purge_result');
			purgePreview = null;
			await refresh();
			notice =
				(result.snapshotFilesReleaseFailed ?? 0) > 0
					? m.server_purge_completed_with_cleanup()
					: m.server_purge_completed({ name: frozen.server.name });
			if (servers.length === 0) {
				addOpen = true;
				await tick();
				addNameInput?.focus();
			}
			await invalidateAll();
		} catch {
			if (
				errorCode === 'server_purge_stale' ||
				errorCode === 'server_purge_invalid_plan' ||
				errorCode?.startsWith('plan_')
			) {
				purgePreview = null;
			}
			if (!errorCode) errorCode = 'server_purge_invalid_plan';
		} finally {
			busy = null;
		}
	}
</script>

<section class="surface p-4" aria-labelledby="server-manager-title" aria-busy={busy !== null}>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="server-manager-title" class="text-base font-semibold">
				{m.server_manager_title()}
			</h2>
			<p class="mt-1 max-w-2xl text-xs text-neutral-400">{m.server_manager_hint()}</p>
		</div>
		<button
			type="button"
			class="btn btn-accent"
			aria-expanded={addOpen}
			aria-controls="server-manager-add-form"
			onclick={toggleAdd}
		>
			{addOpen ? m.server_manager_cancel() : m.server_manager_add()}
		</button>
	</div>

	{#if notice}
		<p class="mt-3 text-sm text-emerald-300" role="status">{notice}</p>
	{/if}
	{#if errorMessage(errorCode)}
		<div class="mt-3 text-sm text-red-300" role="alert">
			<p>{errorMessage(errorCode)}</p>
			{#if errorReference}
				<p class="mt-1 font-mono text-xs">{m.api_error_reference({ id: errorReference })}</p>
			{/if}
		</div>
	{/if}

	{#if addOpen}
		<form
			id="server-manager-add-form"
			class="mt-4 grid gap-3 rounded-xl border border-accent-900/60 bg-accent-950/20 p-4 sm:grid-cols-2"
			onsubmit={(event) => {
				event.preventDefault();
				void addServer();
			}}
		>
			<h3 class="sm:col-span-2 text-sm font-semibold">{m.server_manager_add_title()}</h3>
			<label class="text-sm text-neutral-300">
				{m.server_manager_name()}
				<input
					bind:this={addNameInput}
					bind:value={addName}
					required
					maxlength="80"
					class="input mt-1 w-full"
				/>
			</label>
			<label class="text-sm text-neutral-300">
				{m.server_manager_type()}
				<select bind:value={addType} aria-label={m.server_manager_type()} class="input mt-1 w-full">
					<option value="plex">Plex</option>
					<option value="jellyfin">Jellyfin</option>
					<option value="emby">Emby</option>
				</select>
			</label>
			<label class="text-sm text-neutral-300 sm:col-span-2">
				{m.server_manager_url()}
				<input
					bind:value={addBaseUrl}
					required
					type="url"
					placeholder={addType === 'plex'
						? 'http://192.168.1.10:32400'
						: 'http://192.168.1.10:8096'}
					class="input mt-1 w-full"
				/>
			</label>
			<label class="text-sm text-neutral-300 sm:col-span-2">
				{m.server_manager_credential()}
				<input bind:value={addCredential} required type="password" class="input mt-1 w-full" />
				<span class="mt-1 block text-xs text-neutral-500">
					{m.server_manager_credential_new_hint({ server: typeLabel(addType) })}
				</span>
			</label>
			<div class="flex flex-wrap gap-2 sm:col-span-2">
				<button
					type="button"
					class="btn btn-subtle"
					disabled={busy !== null}
					onclick={testCandidate}
				>
					{busy === 'test-new' ? m.server_manager_testing() : m.server_manager_test()}
				</button>
				<button type="submit" class="btn btn-accent" disabled={busy !== null}>
					{busy === 'add' ? m.server_manager_adding() : m.server_manager_add_action()}
				</button>
			</div>
		</form>
	{/if}

	{#if testResult?.ok}
		<p class="mt-3 text-sm text-emerald-300" role="status">
			{m.server_manager_test_detail({ name: testResult.serverName ?? m.server_manager_test_ok() })}
		</p>
	{/if}

	{#if servers.length === 0 && !addOpen}
		<p class="mt-4 text-sm text-neutral-400">{m.server_manager_empty()}</p>
	{:else if servers.length > 0}
		<ul class="mt-4 space-y-3">
			{#each servers as server (server.id)}
				<li class="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="font-medium text-neutral-100">{server.name}</h3>
								<span class="badge badge-info">{typeLabel(server.type)}</span>
								{#if server.id === activeServerId}
									<span class="badge badge-success">{m.server_manager_active()}</span>
								{/if}
								{#if server.protected}
									<span class="badge badge-muted">{m.server_manager_legacy()}</span>
								{/if}
								{#if server.disconnectedAt}
									<span class="badge badge-muted">{m.server_manager_disconnected_badge()}</span>
								{:else}
									<span class={statusClass(server.connectionStatus)}>
										{statusLabel(server.connectionStatus)}
									</span>
								{/if}
							</div>
							<p class="mt-1 truncate text-xs text-neutral-400">{server.baseUrl ?? '—'}</p>
							<p class="mt-1 text-xs text-neutral-500">
								{m.server_manager_last_tested({ date: formatDate(server.lastTestedAt) })}
								· {server.credentialSet
									? m.server_manager_credential_set()
									: m.server_manager_credential_missing()}
							</p>
						</div>
						{#if !server.disconnectedAt}
							<div class="flex flex-wrap justify-end gap-2">
								{#if server.enabled && server.id !== activeServerId}
									<button
										type="button"
										class="btn btn-accent px-2.5 py-1.5 text-xs"
										disabled={busy !== null}
										onclick={() => serverAction(server, 'activate')}
									>
										{busy === `activate:${server.id}`
											? m.server_manager_switching()
											: m.server_manager_make_active()}
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-subtle px-2.5 py-1.5 text-xs"
									disabled={busy !== null || !server.credentialSet}
									onclick={() => serverAction(server, 'test')}
								>
									{busy === `test:${server.id}`
										? m.server_manager_testing()
										: m.server_manager_test()}
								</button>
								{#if !server.protected}
									<button
										id={`server-edit-${server.id}`}
										type="button"
										class="btn btn-ghost px-2.5 py-1.5 text-xs"
										disabled={busy !== null}
										aria-expanded={editingId === server.id}
										aria-controls={`server-edit-form-${server.id}`}
										onclick={() => void beginEdit(server)}
									>
										{m.server_manager_edit()}
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-ghost px-2.5 py-1.5 text-xs"
									disabled={busy !== null}
									aria-expanded={confirmingDisconnectId === server.id}
									aria-describedby={confirmingDisconnectId === server.id
										? `server-disconnect-warning-${server.id}`
										: undefined}
									onclick={() => serverAction(server, server.enabled ? 'disable' : 'enable')}
								>
									{server.enabled ? m.server_manager_disable() : m.server_manager_enable()}
								</button>
								<button
									type="button"
									class="btn px-2.5 py-1.5 text-xs {confirmingDisconnectId === server.id
										? 'bg-red-900/60 text-red-200'
										: 'btn-ghost'}"
									disabled={busy !== null}
									onclick={() => {
										if (confirmingDisconnectId === server.id) {
											void serverAction(server, 'disconnect');
										} else confirmingDisconnectId = server.id;
									}}
								>
									{confirmingDisconnectId === server.id
										? m.server_manager_disconnect_confirm()
										: m.server_manager_disconnect()}
								</button>
							</div>
						{:else}
							<button
								type="button"
								class="btn bg-red-950/50 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-900/60"
								disabled={busy !== null}
								onclick={() => previewPurge(server)}
							>
								{busy === `purge-preview:${server.id}`
									? m.server_purge_previewing()
									: m.server_purge_action()}
							</button>
						{/if}
					</div>

					{#if confirmingDisconnectId === server.id}
						<p
							id={`server-disconnect-warning-${server.id}`}
							class="mt-3 text-xs text-red-200"
							role="alert"
						>
							{m.server_manager_disconnect_hint({ name: server.name })}
						</p>
					{/if}

					{#if editingId === server.id}
						<form
							id={`server-edit-form-${server.id}`}
							class="mt-4 grid gap-3 border-t border-neutral-800 pt-4 sm:grid-cols-2"
							onsubmit={(event) => {
								event.preventDefault();
								void saveEdit(server.id);
							}}
						>
							<h4 class="text-sm font-semibold sm:col-span-2">{m.server_manager_edit_title()}</h4>
							<label class="text-sm text-neutral-300">
								{m.server_manager_name()}
								<input
									bind:this={editNameInput}
									bind:value={editName}
									required
									maxlength="80"
									class="input mt-1 w-full"
								/>
							</label>
							<label class="text-sm text-neutral-300">
								{m.server_manager_type()}
								<select
									bind:value={editType}
									aria-label={m.server_manager_type()}
									class="input mt-1 w-full"
								>
									<option value="plex">Plex</option>
									<option value="jellyfin">Jellyfin</option>
									<option value="emby">Emby</option>
								</select>
							</label>
							<label class="text-sm text-neutral-300 sm:col-span-2">
								{m.server_manager_url()}
								<input bind:value={editBaseUrl} required type="url" class="input mt-1 w-full" />
							</label>
							<label class="text-sm text-neutral-300 sm:col-span-2">
								{m.server_manager_credential()}
								<input bind:value={editCredential} type="password" class="input mt-1 w-full" />
								<span class="mt-1 block text-xs text-neutral-500">
									{m.server_manager_credential_edit_hint()}
								</span>
							</label>
							<div class="flex gap-2 sm:col-span-2">
								<button type="submit" class="btn btn-accent" disabled={busy !== null}>
									{busy === `edit:${server.id}`
										? m.server_manager_saving()
										: m.server_manager_save()}
								</button>
								<button
									type="button"
									class="btn btn-ghost"
									disabled={busy !== null}
									onclick={() => closeEdit(server.id)}
								>
									{m.server_manager_cancel()}
								</button>
							</div>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<ServerPurgeDialog
	open={purgePreview !== null}
	serverName={purgePreview?.server.name ?? ''}
	impact={purgePreview?.impact ?? null}
	blocked={purgePreview?.blocked ?? false}
	busy={busy?.startsWith('purge-confirm:') ?? false}
	onConfirm={confirmPurge}
	onCancel={cancelPurge}
/>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	type Connection = {
		serverName: string;
		uri: string;
		address: string;
		local: boolean;
		relay: boolean;
		https: boolean;
	};

	let {
		plexUrl = $bindable(''),
		plexTokenSet = $bindable(false),
		onLogin
	}: {
		plexUrl?: string;
		plexTokenSet?: boolean;
		/** Called once after a successful login (e.g. to invalidate page data). */
		onLogin?: () => void | Promise<void>;
	} = $props();

	let login = $state<{
		code: string;
		authUrl: string;
		linkUrl: string;
		status: 'pending' | 'done' | 'error';
		error?: string;
	} | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}
	onDestroy(stopPolling);

	export async function startPlexLogin() {
		stopPolling();
		login = null;
		try {
			const res = await fetch('/api/plex/pin', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Could not create a PIN');
			login = {
				code: body.code,
				authUrl: body.authUrl,
				linkUrl: body.linkUrl,
				status: 'pending'
			};
			const id = body.id as number;
			const expiresAt = body.expiresAt ? new Date(body.expiresAt).getTime() : Date.now() + 600_000;
			pollTimer = setInterval(async () => {
				if (Date.now() > expiresAt) {
					stopPolling();
					if (login) login = { ...login, status: 'error', error: 'The PIN expired. Try again.' };
					return;
				}
				try {
					const pr = await fetch(`/api/plex/pin/${id}`);
					const pb = await pr.json();
					if (pb.authorized) {
						stopPolling();
						plexTokenSet = true;
						if (login) login = { ...login, status: 'done' };
						await onLogin?.();
						await loadConnections();
					}
				} catch {
					// transient; keep polling until expiry
				}
			}, 2000);
		} catch (e) {
			login = {
				code: '',
				authUrl: '',
				linkUrl: '',
				status: 'error',
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}

	let connections = $state<Connection[]>([]);
	let loadingConnections = $state(false);
	let connectionError = $state<string | null>(null);

	async function loadConnections() {
		loadingConnections = true;
		connectionError = null;
		try {
			const res = await fetch('/api/plex/connections');
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Discovery failed');
			connections = body.connections ?? [];
		} catch (e) {
			connectionError = e instanceof Error ? e.message : String(e);
		} finally {
			loadingConnections = false;
		}
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<div>
			<p class="text-sm font-medium">
				{m.settings_plex_account()}
				<span class="badge badge-changed ml-1">{m.settings_plex_recommended()}</span>
			</p>
			<p class="text-xs text-neutral-400">
				{plexTokenSet ? m.settings_plex_token_set() : m.settings_plex_login_hint()}
			</p>
		</div>
		<button onclick={startPlexLogin} class="btn btn-accent px-3 py-1.5">
			{plexTokenSet ? m.settings_log_in_again() : m.settings_log_in()}
		</button>
	</div>

	{#if login}
		{#if login.status === 'pending'}
			<div class="rounded-md border border-neutral-800 bg-black/40 p-3 text-sm">
				<p>
					{m.settings_plex_open_link_pre()}
					<a href={login.linkUrl} target="_blank" rel="noopener" class="text-accent-300 underline">
						plex.tv/link
					</a>
					{m.settings_plex_open_link_post()}
				</p>
				<p class="mt-2 font-mono text-2xl tracking-widest text-accent-200">{login.code}</p>
				<p class="mt-2 text-xs text-neutral-400">
					{m.settings_plex_or_authorize_pre()}
					<a href={login.authUrl} target="_blank" rel="noopener" class="text-accent-300 underline"
						>{m.settings_plex_authorize_directly()}</a
					>{m.settings_plex_waiting()}
				</p>
			</div>
		{:else if login.status === 'done'}
			<p class="text-sm text-emerald-400">{m.settings_plex_logged_in()}</p>
		{:else}
			<p class="text-sm text-red-400">{login.error}</p>
		{/if}
	{/if}

	<div>
		<div class="flex items-center justify-between">
			<label for="plexUrl" class="mb-1 block text-sm font-medium">{m.settings_plex_url()}</label>
			<button
				onclick={loadConnections}
				disabled={!plexTokenSet || loadingConnections}
				class="btn btn-ghost px-2 py-1 text-xs"
			>
				{loadingConnections ? m.settings_finding() : m.settings_find_servers()}
			</button>
		</div>
		<input
			id="plexUrl"
			bind:value={plexUrl}
			placeholder="http://192.168.1.10:32400"
			class="input w-full"
		/>

		{#if connectionError}<p class="mt-1 text-xs text-red-400">{connectionError}</p>{/if}
		{#if connections.length}
			<div class="mt-2 space-y-1">
				{#each connections as conn (conn.uri)}
					<button
						onclick={() => (plexUrl = conn.uri)}
						class="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs transition {plexUrl ===
						conn.uri
							? 'border-accent-600 bg-accent-950/60'
							: 'border-neutral-700 hover:border-neutral-500'}"
					>
						<span class="truncate">
							<span class="text-neutral-200">{conn.serverName}</span>
							<span class="ml-1 text-neutral-400">{conn.uri}</span>
						</span>
						<span class="ml-2 flex shrink-0 gap-1">
							<span class="badge {conn.local ? 'badge-changed' : 'badge-muted'}">
								{conn.local ? m.settings_local() : m.settings_remote()}
							</span>
							{#if conn.relay}<span class="badge badge-muted">{m.settings_relay()}</span>{/if}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

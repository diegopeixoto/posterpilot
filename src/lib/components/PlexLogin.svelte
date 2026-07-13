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
	/** The OAuth tab we opened. Not reactive — only its blocked state drives the UI. */
	let authTab: Window | null = null;
	let tabBlocked = $state(false);

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	function closeTab() {
		try {
			authTab?.close();
		} catch {
			// A cross-origin tab can throw on close(); ignore.
		}
		authTab = null;
	}

	onDestroy(() => {
		stopPolling();
		closeTab();
	});

	export async function startPlexLogin() {
		stopPolling();
		closeTab();
		tabBlocked = false;
		login = null;
		// Open the tab synchronously inside the click gesture so the browser doesn't
		// block it; we navigate it to the OAuth URL once the PIN exists. (Opening after
		// the awaited fetch would lose the gesture and get blocked.)
		authTab = window.open('about:blank', '_blank');
		tabBlocked = authTab === null;
		try {
			const res = await fetch('/api/plex/pin', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error('plex_login_failed');
			login = {
				code: body.code,
				authUrl: body.authUrl,
				linkUrl: body.linkUrl,
				status: 'pending'
			};

			if (authTab) {
				try {
					authTab.location.href = body.authUrl;
				} catch {
					tabBlocked = true;
				}
			}

			const id = body.id as number;
			const expiresAt = body.expiresAt ? new Date(body.expiresAt).getTime() : Date.now() + 600_000;
			pollTimer = setInterval(async () => {
				if (Date.now() > expiresAt) {
					stopPolling();
					closeTab();
					if (login) login = { ...login, status: 'error', error: m.settings_plex_pin_expired() };
					return;
				}
				try {
					const pr = await fetch(`/api/plex/pin/${id}`);
					const pb = await pr.json();
					if (pb.authorized) {
						stopPolling();
						closeTab();
						plexTokenSet = true;
						if (login) login = { ...login, status: 'done' };
						await onLogin?.();
						await loadConnections();
					}
				} catch {
					// transient; keep polling until expiry
				}
			}, 2000);
		} catch {
			closeTab();
			login = {
				code: '',
				authUrl: '',
				linkUrl: '',
				status: 'error',
				error: m.settings_plex_login_failed()
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
			if (!res.ok) throw new Error('plex_discovery_failed');
			connections = body.connections ?? [];
		} catch {
			connectionError = m.settings_plex_discovery_failed();
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
		<!--
			Brand exception to the violet-only rule: a recognizable Plex sign-in button
			in Plex gold (#e5a00d) with near-black text for AA contrast. Keyboard focus
			uses the shared :focus-visible ring; motion is the .btn transition only,
			which the global reduced-motion rule already neutralizes.
		-->
		<button
			type="button"
			onclick={startPlexLogin}
			aria-label={plexTokenSet
				? m.settings_plex_reconnect_button()
				: m.settings_plex_login_button()}
			class="btn shrink-0 gap-2 bg-[#e5a00d] font-semibold text-neutral-950 hover:bg-[#cc8f0c]"
		>
			<svg
				viewBox="0 0 24 24"
				class="h-4 w-4"
				fill="currentColor"
				aria-hidden="true"
				focusable="false"
			>
				<path d="M9.882 0H4.235l6.353 12-6.353 12h5.647l6.353-12z" />
			</svg>
			<span>
				{plexTokenSet ? m.settings_plex_reconnect_button() : m.settings_plex_login_button()}
			</span>
		</button>
	</div>

	{#if login}
		{#if login.status === 'pending'}
			{#if tabBlocked}
				<!-- New tab blocked: show the full manual plex.tv/link fallback. -->
				<div class="rounded-md border border-neutral-800 bg-black/40 p-3 text-sm">
					<p class="mb-2 text-amber-300">{m.settings_plex_tab_blocked()}</p>
					<p>
						{m.settings_plex_open_link_pre()}
						<a href={login.linkUrl} target="_blank" rel="noopener" class="text-accent-300 underline"
							>plex.tv/link</a
						>
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
			{:else}
				<!-- Tab open: keep the manual code one disclosure away as a fallback. -->
				<div class="rounded-md border border-neutral-800 bg-black/40 p-3 text-sm">
					<p class="text-neutral-300">{m.settings_plex_tab_waiting()}</p>
					<details class="mt-2 text-xs text-neutral-400">
						<summary class="cursor-pointer select-none hover:text-neutral-200">
							{m.settings_plex_enter_code_manually()}
						</summary>
						<div class="mt-2">
							<p>
								{m.settings_plex_open_link_pre()}
								<a
									href={login.linkUrl}
									target="_blank"
									rel="noopener"
									class="text-accent-300 underline">plex.tv/link</a
								>
								{m.settings_plex_open_link_post()}
							</p>
							<p class="mt-1 font-mono text-xl tracking-widest text-accent-200">{login.code}</p>
							<p class="mt-1">
								{m.settings_plex_or_authorize_pre()}
								<a
									href={login.authUrl}
									target="_blank"
									rel="noopener"
									class="text-accent-300 underline">{m.settings_plex_authorize_directly()}</a
								>{m.settings_plex_waiting()}
							</p>
						</div>
					</details>
				</div>
			{/if}
		{:else if login.status === 'done'}
			<p class="text-sm text-emerald-400" role="status">{m.settings_plex_logged_in()}</p>
		{:else}
			<p class="text-sm text-red-400" role="alert">{login.error}</p>
		{/if}
	{/if}

	<div>
		<div class="flex items-center justify-between">
			<label for="plexUrl" class="mb-1 block text-sm font-medium">{m.settings_plex_url()}</label>
			<button
				type="button"
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

		{#if connectionError}<p class="mt-1 text-xs text-red-400" role="alert">
				{connectionError}
			</p>{/if}
		{#if connections.length}
			<div class="mt-2 space-y-1">
				{#each connections as conn (conn.uri)}
					<button
						type="button"
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

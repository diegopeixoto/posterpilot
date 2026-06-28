<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let {
		flavor,
		serverUrl = $bindable(''),
		apiKeySet = $bindable(false),
		onLogin
	}: {
		/** Which media server this form logs in to. */
		flavor: 'jellyfin' | 'emby';
		serverUrl?: string;
		apiKeySet?: boolean;
		/** Called once after a successful login (e.g. to invalidate page data). */
		onLogin?: () => void | Promise<void>;
	} = $props();

	const serverName = $derived(flavor === 'jellyfin' ? 'Jellyfin' : 'Emby');

	// The password lives only in this component's state for the duration of the
	// request and is cleared right after a successful login — never persisted.
	let username = $state('');
	let password = $state('');

	let loggingIn = $state(false);
	let status = $state<{ kind: 'ok'; user: string } | { kind: 'error'; error: string } | null>(null);

	async function logIn(event: SubmitEvent) {
		event.preventDefault();
		if (loggingIn) return;
		const baseUrl = serverUrl.trim();
		if (!baseUrl || !username.trim()) {
			status = { kind: 'error', error: m.settings_login_missing_fields() };
			return;
		}
		loggingIn = true;
		status = null;
		try {
			const res = await fetch('/api/media-server/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ flavor, baseUrl, username: username.trim(), password })
			});
			const body = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				userName?: string;
				error?: string;
			};
			if (!res.ok || !body.ok) throw new Error(body.error ?? String(res.status));
			// The server saved the URL + access token; reflect "connected" immediately
			// and drop the password so it never lingers in client state.
			apiKeySet = true;
			password = '';
			status = { kind: 'ok', user: body.userName ?? username.trim() };
			await onLogin?.();
		} catch (e) {
			status = { kind: 'error', error: e instanceof Error ? e.message : String(e) };
		} finally {
			loggingIn = false;
		}
	}
</script>

<form class="space-y-4" onsubmit={logIn}>
	<div>
		<p class="text-sm font-medium">
			{m.settings_login_account({ server: serverName })}
			<span class="badge badge-changed ml-1">{m.settings_plex_recommended()}</span>
		</p>
		<p class="text-xs text-neutral-400">
			{apiKeySet ? m.settings_plex_token_set() : m.settings_login_hint({ server: serverName })}
		</p>
	</div>

	<div>
		<label for="{flavor}-loginUrl" class="mb-1 block text-sm font-medium"
			>{m.settings_server_url()}</label
		>
		<input
			id="{flavor}-loginUrl"
			bind:value={serverUrl}
			placeholder="http://192.168.1.10:8096"
			class="input w-full"
		/>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label for="{flavor}-loginUser" class="mb-1 block text-sm font-medium"
				>{m.settings_username()}</label
			>
			<input
				id="{flavor}-loginUser"
				bind:value={username}
				autocomplete="username"
				class="input w-full"
			/>
		</div>
		<div>
			<label for="{flavor}-loginPass" class="mb-1 block text-sm font-medium"
				>{m.settings_password()}</label
			>
			<input
				id="{flavor}-loginPass"
				type="password"
				bind:value={password}
				autocomplete="current-password"
				class="input w-full"
			/>
		</div>
	</div>

	<div class="flex items-center gap-3">
		<button type="submit" disabled={loggingIn} class="btn btn-accent px-3 py-1.5">
			{loggingIn
				? m.settings_logging_in()
				: apiKeySet
					? m.settings_log_in_again()
					: m.settings_log_in()}
		</button>
		{#if status?.kind === 'ok'}
			<span class="text-sm text-emerald-400" role="status"
				>{m.settings_login_success({ user: status.user })}</span
			>
		{:else if status?.kind === 'error'}
			<span class="text-sm text-red-400" role="alert">{status.error}</span>
		{/if}
	</div>
</form>

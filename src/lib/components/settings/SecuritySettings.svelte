<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { toasts } from '$lib/stores/toasts.svelte';

	// Auth summary from the page load (never the password hash).
	let {
		auth
	}: {
		auth: {
			storedMode: 'disabled' | 'enabled' | 'local';
			username: string | null;
			hasPassword: boolean;
			envManaged: boolean;
		};
	} = $props();

	// svelte-ignore state_referenced_locally
	let authMode = $state<'disabled' | 'enabled' | 'local'>(auth.storedMode);
	// svelte-ignore state_referenced_locally
	let authUsername = $state(auth.username ?? '');
	// svelte-ignore state_referenced_locally
	let hasPassword = $state(auth.hasPassword);
	let authPassword = $state('');
	let savingAuth = $state(false);
	let authSaved = $state(false);
	let authError = $state('');

	const modes = [
		{ v: 'disabled', l: m.security_mode_disabled, d: m.security_mode_disabled_hint },
		{ v: 'local', l: m.security_mode_local, d: m.security_mode_local_hint },
		{ v: 'enabled', l: m.security_mode_enabled, d: m.security_mode_enabled_hint }
	] as const;

	async function saveSecurity() {
		savingAuth = true;
		authSaved = false;
		authError = '';
		try {
			const body: Record<string, string> = { mode: authMode };
			if (authUsername.trim()) body.username = authUsername.trim();
			if (authPassword) body.password = authPassword;
			const res = await fetch('/api/auth/credentials', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			await res.json().catch(() => ({}));
			if (!res.ok) {
				authError = m.security_save_error();
				toasts.error(authError);
				return;
			}
			authPassword = '';
			hasPassword = hasPassword || !!body.password;
			authSaved = true;
			toasts.success(m.settings_saved());
		} catch {
			authError = m.security_save_error();
			toasts.error(authError);
		} finally {
			savingAuth = false;
		}
	}
</script>

<section class="max-w-xl space-y-5" aria-labelledby="security-settings-title">
	<div>
		<h2 id="security-settings-title" class="text-sm font-semibold">{m.security_title()}</h2>
		<p class="mt-1 text-sm text-neutral-400">{m.security_intro()}</p>
	</div>

	{#if auth.envManaged}
		<p
			class="flex items-start gap-2 rounded-md border border-amber-900/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
			role="status"
		>
			<span aria-hidden="true">🔒</span>{m.security_env_locked()}
		</p>
	{/if}

	<fieldset class="space-y-2" disabled={auth.envManaged}>
		<legend class="mb-1 text-sm font-medium">{m.security_mode_label()}</legend>
		{#each modes as opt (opt.v)}
			<label
				class="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-800 p-3 has-[:checked]:border-accent-600 has-[:checked]:bg-accent-950/30"
			>
				<input
					type="radio"
					name="authMode"
					value={opt.v}
					checked={authMode === opt.v}
					onchange={() => (authMode = opt.v)}
					class="mt-0.5 accent-accent-500"
				/>
				<span>
					<span class="block text-sm font-medium text-neutral-100">{opt.l()}</span>
					<span class="block text-xs text-neutral-400">{opt.d()}</span>
				</span>
			</label>
		{/each}
	</fieldset>

	<div class="space-y-3" class:opacity-50={authMode === 'disabled'}>
		<div>
			<label for="authUsername" class="mb-1 block text-sm font-medium"
				>{m.security_username()}</label
			>
			<input
				id="authUsername"
				type="text"
				autocomplete="username"
				bind:value={authUsername}
				disabled={auth.envManaged || authMode === 'disabled'}
				class="input w-full"
			/>
		</div>
		<div>
			<label for="authPassword" class="mb-1 block text-sm font-medium"
				>{m.security_password()}</label
			>
			<input
				id="authPassword"
				type="password"
				autocomplete="new-password"
				placeholder={hasPassword ? m.security_password_set() : ''}
				bind:value={authPassword}
				disabled={auth.envManaged || authMode === 'disabled'}
				class="input w-full"
			/>
			<p class="mt-1 text-xs text-neutral-500">{m.security_password_hint()}</p>
		</div>
	</div>

	<div class="flex items-center gap-3 border-t border-neutral-800 pt-4">
		<button
			onclick={saveSecurity}
			disabled={savingAuth || auth.envManaged}
			class="btn btn-accent px-4 py-2"
		>
			{savingAuth ? m.settings_saving() : m.settings_save()}
		</button>
		{#if authSaved}<span class="text-sm text-emerald-400" role="status">{m.settings_saved()}</span
			>{/if}
		{#if authError}<span class="text-sm text-red-300" role="alert">{authError}</span>{/if}
	</div>
</section>

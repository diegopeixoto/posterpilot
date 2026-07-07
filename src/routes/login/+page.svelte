<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { m } from '$lib/paraglide/messages';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '/');
	const errorText = $derived(
		form?.error === 'locked' ? m.login_error_locked() : form?.error ? m.login_error_invalid() : ''
	);
</script>

<svelte:head><title>{m.login_title()} · {m.app_name()}</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-semibold tracking-tight text-neutral-100">{m.app_name()}</h1>
			<p class="mt-1 text-sm text-neutral-400">{m.login_subtitle()}</p>
		</div>

		<form
			method="POST"
			use:enhance
			class="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 shadow-2xl"
		>
			<input type="hidden" name="redirectTo" value={redirectTo} />

			{#if errorText}
				<p
					class="flex items-center gap-2 rounded-md bg-red-900/40 px-3 py-2 text-sm text-red-200"
					role="alert"
				>
					<span aria-hidden="true">⚠</span>{errorText}
				</p>
			{/if}

			<label class="block">
				<span class="mb-1 block text-sm font-medium text-neutral-300">{m.login_username()}</span>
				<input
					name="username"
					type="text"
					autocomplete="username"
					required
					value={form?.username ?? ''}
					class="input w-full"
				/>
			</label>

			<label class="block">
				<span class="mb-1 block text-sm font-medium text-neutral-300">{m.login_password()}</span>
				<input
					name="password"
					type="password"
					autocomplete="current-password"
					required
					class="input w-full"
				/>
			</label>

			<button type="submit" class="btn btn-accent w-full">{m.login_submit()}</button>
		</form>
	</div>
</div>

<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { setLocale } from '$lib/paraglide/runtime';
	import { registerClientLocaleStrategy, seedClientLocale } from '$lib/i18n/strategy.client';

	// Cross-fade between pages using the View Transitions API where supported.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	let { children, data } = $props();

	// Register the client locale strategy and seed it with the locale the server
	// resolved for this page so hydration matches SSR.
	registerClientLocaleStrategy();
	seedClientLocale(data.locale);

	const links = $derived([
		{ href: '/', label: m.nav_dashboard() },
		{ href: '/library', label: m.nav_library() },
		{ href: '/settings', label: m.nav_settings() }
	]);

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	// Best-effort update check (cached server-side; never blocks the page).
	let update = $state<{ updateAvailable: boolean; latest: string | null; url: string } | null>(
		null
	);
	onMount(async () => {
		try {
			const res = await fetch('/api/update');
			if (res.ok) update = await res.json();
		} catch {
			// Ignore — the update check is optional.
		}
	});

	// Selecting a language persists it (via the custom strategy's settings write)
	// and reloads so the next SSR pass renders in the new locale.
	function onLanguageChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		setLocale(value as Parameters<typeof setLocale>[0]);
	}
</script>

<div class="min-h-screen">
	<header class="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
			<a href="/" class="flex items-center" aria-label={m.app_name()}>
				<img src="/logo.png" alt={m.app_name()} class="h-7 w-auto" />
			</a>
			<nav class="flex items-center gap-1 text-sm">
				{#each links as link (link.href)}
					<a
						href={link.href}
						class="rounded-md px-3 py-1.5 transition {isActive(link.href)
							? 'bg-accent-600/15 text-accent-200'
							: 'text-neutral-400 hover:text-neutral-100'}"
					>
						{link.label}
						{#if link.href === '/' && data.activeJobs > 0}
							<span class="ml-1 rounded-full bg-accent-500 px-1.5 text-[10px] text-white"
								>{data.activeJobs}</span
							>
						{/if}
					</a>
				{/each}
			</nav>
			<label class="ml-auto flex items-center gap-1.5 text-sm text-neutral-400">
				<span class="sr-only">{m.language_label()}</span>
				<select
					value={data.locale}
					onchange={onLanguageChange}
					aria-label={m.language_label()}
					class="input py-1 text-sm"
				>
					{#each data.availableLocales as loc (loc.code)}
						<option value={loc.code}>{loc.name}</option>
					{/each}
				</select>
			</label>
		</div>
	</header>

	{#if !data.configReady}
		<div
			class="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300"
		>
			{m.banner_configure()}
			<a href="/setup" class="font-semibold underline">{m.settings_get_started()}</a>
			<span class="text-amber-500/60">·</span>
			<a href="/settings" class="font-semibold underline">{m.banner_settings_link()}</a>
		</div>
	{/if}

	{#if update?.updateAvailable}
		<div
			class="border-b border-accent-900/50 bg-accent-950/40 px-4 py-2 text-center text-sm text-accent-200"
		>
			{m.update_available({ version: update.latest ?? '' })}
			<a href={update.url} target="_blank" rel="noopener" class="font-semibold underline"
				>{m.update_view()}</a
			>
		</div>
	{/if}

	<main class="mx-auto max-w-7xl px-4 py-6">
		{@render children()}
	</main>

	<footer class="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-neutral-600">
		<a
			href="https://github.com/diegopeixoto/posterpilot"
			target="_blank"
			rel="noopener"
			class="hover:text-neutral-400"
		>
			{m.app_name()}
		</a>
		<span class="text-neutral-700">·</span> v{data.version}
		<p class="mx-auto mt-1 max-w-2xl text-neutral-700">{m.footer_disclaimer()}</p>
	</footer>
</div>

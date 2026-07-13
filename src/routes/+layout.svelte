<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { onNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { setLocale } from '$lib/paraglide/runtime';
	import { registerClientLocaleStrategy, seedClientLocale } from '$lib/i18n/strategy.client';
	import { canonicalPathAfterServerSwitch } from '$lib/server-context-navigation';
	import WhatsNewModal from '$lib/components/WhatsNewModal.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	// Local copy of the version comparison (the canonical `isNewerVersion` lives in
	// `$lib/server/semver`, which SvelteKit forbids importing into client code).
	// True when dotted version `a` is strictly newer than `b` (leading `v` ignored).
	function isNewerVersion(a: string, b: string): boolean {
		const parse = (s: string) =>
			s
				.trim()
				.replace(/^v/i, '')
				.split('.')
				.map((n) => Number.parseInt(n, 10) || 0);
		const pa = parse(a);
		const pb = parse(b);
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const x = pa[i] ?? 0;
			const y = pb[i] ?? 0;
			if (x !== y) return x > y;
		}
		return false;
	}

	// Cross-fade between pages using the View Transitions API where supported.
	// Skipped when the user prefers reduced motion (navigation stays instant).
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
	// svelte-ignore state_referenced_locally
	seedClientLocale(data.locale);
	registerClientLocaleStrategy();

	const links = $derived([
		{ href: '/', label: m.nav_dashboard() },
		{ href: '/library', label: m.nav_library() },
		{ href: '/collections', label: m.nav_collections() },
		{ href: '/review', label: m.nav_review() },
		{ href: '/kometa', label: m.nav_kometa() },
		...(data.funEnabled ? [{ href: '/fun', label: m.nav_fun() }] : []),
		{ href: '/settings', label: m.nav_settings() }
	]);

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	// Best-effort update check (cached server-side; never blocks the page).
	type Update = {
		updateAvailable: boolean;
		latest: string | null;
		url: string;
		name: string | null;
		body: string | null;
		currentName: string | null;
		currentBody: string | null;
		currentUrl: string;
		currentResolved: boolean;
	};
	let update = $state<Update | null>(null);
	let appHydrated = $state(false);

	// "What's new" modal. Two intents share it: 'current' shows the notes for the
	// version you're running (post-upgrade), 'latest' previews the available
	// release (the update banner's link). Content is picked from `update` by mode.
	let whatsNewOpen = $state(false);
	let whatsNewMode = $state<'current' | 'latest'>('current');

	const whatsNew = $derived(
		whatsNewMode === 'latest'
			? {
					version: update?.latest ?? data.version,
					name: update?.name ?? null,
					body: update?.body ?? null,
					url: update?.url ?? 'https://github.com/diegopeixoto/posterpilot/releases'
				}
			: {
					version: data.version,
					name: update?.currentName ?? null,
					body: update?.currentBody ?? null,
					url: update?.currentUrl ?? 'https://github.com/diegopeixoto/posterpilot/releases'
				}
	);

	const LAST_SEEN_KEY = 'pp_lastSeenVersion';

	// Re-check for updates; safe to call repeatedly (server-side cached ~1h; SWR-enabled).
	async function refreshUpdate() {
		try {
			const res = await fetch('/api/update');
			if (res.ok) update = await res.json();
		} catch {
			// Ignore — the update check is optional.
		}
	}

	// One-time-after-update: show the modal once when the running version is newer
	// than the last version the user saw. Shown only after the running version's
	// release notes actually resolved from GitHub, and the "seen" marker is written
	// only then — so a failed/slow check (or a GitHub tag lookup that hasn't
	// recovered yet) retries on the next load instead of flashing an empty modal
	// and burning the prompt.
	function maybeShowWhatsNew() {
		try {
			const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
			if (lastSeen === null) {
				localStorage.setItem(LAST_SEEN_KEY, data.version); // first run: seed silently
				return;
			}
			if (!isNewerVersion(data.version, lastSeen)) return;
			// Wait until the running version's own notes are available, not just until
			// /api/update returned (it returns a non-null object even if the tag lookup failed).
			if (!update?.currentResolved) return;
			whatsNewMode = 'current';
			whatsNewOpen = true;
			localStorage.setItem(LAST_SEEN_KEY, data.version);
		} catch {
			// Ignore — localStorage may be unavailable (private mode, etc.).
		}
	}

	onMount(() => {
		appHydrated = true;
		// Decide whether to show the "What's new" modal only once the check resolves.
		void refreshUpdate().then(maybeShowWhatsNew);

		// Re-check periodically and when the tab regains focus, so a long-open
		// dashboard notices a new release without a full restart/reload.
		const SIX_HOURS = 6 * 60 * 60 * 1000;
		const interval = setInterval(refreshUpdate, SIX_HOURS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') refreshUpdate();
		};
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// Selecting a language persists it (via the custom strategy's settings write)
	// and reloads so the next SSR pass renders in the new locale. The persist +
	// reload takes a beat, so we show a pending state immediately — without it the
	// switch looks like it did nothing until the reload lands.
	let switchingLocale = $state(false);
	let switchingServer = $state(false);
	let mobileMenuOpen = $state(false);
	function onLanguageChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === data.locale) return;
		switchingLocale = true;
		// setLocale persists then reloads. If it rejects (e.g. the settings write
		// fails) clear the pending state so the control isn't stuck disabled.
		Promise.resolve(setLocale(value as Parameters<typeof setLocale>[0])).catch(() => {
			switchingLocale = false;
		});
	}

	async function onServerChange(event: Event) {
		const id = (event.currentTarget as HTMLSelectElement).value;
		if (!id || id === data.serverSelection.activeServerId || switchingServer) return;
		switchingServer = true;
		try {
			const response = await fetch(`/api/servers/${encodeURIComponent(id)}/activate`, {
				method: 'POST'
			});
			if (!response.ok) throw new Error(String(response.status));
			await goto(canonicalPathAfterServerSwitch(page.url), {
				invalidateAll: true,
				noScroll: true,
				keepFocus: true,
				replaceState: true
			});
		} catch {
			toasts.error(m.server_switcher_failed());
		} finally {
			switchingServer = false;
		}
	}

	// Clear the session server-side, then land on the login page.
	async function logout() {
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
		} catch {
			// Even if the request fails, send the user to /login.
		}
		await goto('/login');
	}
</script>

<div class="min-h-screen" data-app-hydrated={appHydrated ? 'true' : undefined}>
	<header class="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
		<div
			class="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-3 px-4 py-2 lg:h-14 lg:flex-nowrap lg:gap-6 lg:py-0"
		>
			<a href="/" class="flex items-center" aria-label={m.app_name()}>
				<img src="/logo.png" alt={m.app_name()} class="h-7 w-auto" />
			</a>
			<button
				type="button"
				class="btn btn-ghost ml-auto px-2.5 lg:hidden"
				aria-expanded={mobileMenuOpen}
				aria-controls="primary-navigation"
				aria-label={mobileMenuOpen ? m.nav_menu_close() : m.nav_menu_open()}
				onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			>
				<span aria-hidden="true">{mobileMenuOpen ? '×' : '☰'}</span>
			</button>

			<div
				id="primary-navigation"
				class="{mobileMenuOpen
					? 'flex'
					: 'hidden'} order-last w-full flex-col gap-3 border-t border-neutral-800 pt-3 lg:order-none lg:flex lg:min-w-0 lg:flex-1 lg:flex-row lg:items-center lg:border-0 lg:pt-0"
			>
				<nav
					class="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4 lg:flex lg:min-w-0 lg:items-center lg:overflow-x-auto lg:whitespace-nowrap"
				>
					{#each links as link (link.href)}
						<a
							href={link.href}
							aria-current={isActive(link.href) ? 'page' : undefined}
							onclick={() => (mobileMenuOpen = false)}
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

				<div class="flex flex-col gap-2 sm:flex-row sm:items-center lg:ml-auto lg:flex-none">
					{#if data.serverSelection.servers.length > 1}
						<label
							class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-neutral-400"
							aria-busy={switchingServer}
						>
							<span class="sr-only">{m.server_switcher_label()}</span>
							<select
								value={data.serverSelection.activeServerId ?? ''}
								onchange={onServerChange}
								aria-label={m.server_switcher_label()}
								disabled={switchingServer}
								class="input w-full py-1 text-sm disabled:opacity-60 lg:max-w-48"
							>
								{#each data.serverSelection.servers as server (server.id)}
									<option value={server.id}
										>{server.name} · {server.type === 'jellyfin'
											? 'Jellyfin'
											: server.type === 'emby'
												? 'Emby'
												: 'Plex'}</option
									>
								{/each}
							</select>
						</label>
					{/if}
					<label
						class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-neutral-400"
						aria-busy={switchingLocale}
					>
						<span class="sr-only">{m.language_label()}</span>
						{#if switchingLocale}
							<svg
								class="size-3.5 motion-safe:animate-spin text-accent-400"
								viewBox="0 0 24 24"
								fill="none"
								aria-hidden="true"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="3"
								/>
								<path
									class="opacity-90"
									fill="currentColor"
									d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
								/>
							</svg>
						{/if}
						<select
							value={data.locale}
							onchange={onLanguageChange}
							aria-label={m.language_label()}
							disabled={switchingLocale}
							class="input w-full py-1 text-sm disabled:opacity-60 sm:w-auto"
						>
							{#each data.availableLocales as loc (loc.code)}
								<option value={loc.code}>{loc.name}</option>
							{/each}
						</select>
					</label>
					{#if data.showLogout}
						<button type="button" onclick={logout} class="btn btn-ghost sm:flex-none">
							{m.auth_logout()}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</header>

	{#if data.maintenanceActive}
		<div
			class="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300"
			role="status"
		>
			{m.maintenance_banner()}
		</div>
	{/if}

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
			<button
				type="button"
				onclick={() => {
					whatsNewMode = 'latest';
					whatsNewOpen = true;
				}}
				class="font-semibold underline"
			>
				{m.update_whats_new()}
			</button>
			<span class="text-accent-500/60">·</span>
			<a href={update.url} target="_blank" rel="noopener" class="font-semibold underline"
				>{m.update_view()}</a
			>
		</div>
	{/if}

	<main class="mx-auto max-w-7xl px-4 py-6">
		{#key data.serverSelection.activeServerId}
			{@render children()}
		{/key}
	</main>

	<footer class="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-neutral-400">
		<a
			href="https://github.com/diegopeixoto/posterpilot"
			target="_blank"
			rel="noopener"
			class="hover:text-neutral-200"
		>
			{m.app_name()}
		</a>
		<span class="text-neutral-600">·</span> v{data.version}
		<p class="mx-auto mt-1 max-w-2xl text-neutral-400">{m.footer_disclaimer()}</p>
	</footer>
</div>

<WhatsNewModal
	bind:open={whatsNewOpen}
	version={whatsNew.version}
	name={whatsNew.name}
	body={whatsNew.body}
	url={whatsNew.url}
/>

<Toaster />

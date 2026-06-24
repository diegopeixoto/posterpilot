<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { setLocale } from '$lib/paraglide/runtime';
	import { registerClientLocaleStrategy, seedClientLocale } from '$lib/i18n/strategy.client';
	import WhatsNewModal from '$lib/components/WhatsNewModal.svelte';

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
	type Update = {
		updateAvailable: boolean;
		latest: string | null;
		url: string;
		name: string | null;
		body: string | null;
		currentName: string | null;
		currentBody: string | null;
		currentUrl: string;
	};
	let update = $state<Update | null>(null);

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

	// Re-check for updates; safe to call repeatedly (server-side cached ~6h).
	async function refreshUpdate() {
		try {
			const res = await fetch('/api/update');
			if (res.ok) update = await res.json();
		} catch {
			// Ignore — the update check is optional.
		}
	}

	onMount(() => {
		refreshUpdate();

		// Re-check periodically and when the tab regains focus, so a long-open
		// dashboard notices a new release without a full restart/reload.
		const SIX_HOURS = 6 * 60 * 60 * 1000;
		const interval = setInterval(refreshUpdate, SIX_HOURS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') refreshUpdate();
		};
		document.addEventListener('visibilitychange', onVisible);

		// One-time-after-update: show the modal once when the running version is
		// newer than the last version the user saw. The modal shows the RUNNING
		// version's notes ('current' mode). On first ever run, seed silently.
		try {
			const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
			if (lastSeen === null) {
				localStorage.setItem(LAST_SEEN_KEY, data.version);
			} else if (isNewerVersion(data.version, lastSeen)) {
				whatsNewMode = 'current';
				whatsNewOpen = true;
				localStorage.setItem(LAST_SEEN_KEY, data.version);
			}
		} catch {
			// Ignore — localStorage may be unavailable (private mode, etc.).
		}

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
			<label
				class="ml-auto flex items-center gap-1.5 text-sm text-neutral-400"
				aria-busy={switchingLocale}
			>
				<span class="sr-only">{m.language_label()}</span>
				{#if switchingLocale}
					<svg
						class="size-3.5 animate-spin text-accent-400"
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
					class="input py-1 text-sm disabled:opacity-60"
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
		{@render children()}
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

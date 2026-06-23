<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children, data } = $props();

	const links = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/library', label: 'Library' },
		{ href: '/jobs', label: 'Jobs' },
		{ href: '/settings', label: 'Settings' }
	];

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen">
	<header class="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
			<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
				<span class="text-accent-400">●</span> posterpilot
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
						{#if link.href === '/jobs' && data.activeJobs > 0}
							<span class="ml-1 rounded-full bg-accent-500 px-1.5 text-[10px] text-white"
								>{data.activeJobs}</span
							>
						{/if}
					</a>
				{/each}
			</nav>
		</div>
	</header>

	{#if !data.configReady}
		<div
			class="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300"
		>
			Configure Plex and TMDB in <a href="/settings" class="font-semibold underline">Settings</a> to get
			started.
		</div>
	{/if}

	<main class="mx-auto max-w-7xl px-4 py-6">
		{@render children()}
	</main>
</div>

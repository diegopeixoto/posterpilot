<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';

	let { children } = $props();
	const links = [
		{ href: '/fun', label: m.fun_nav_picker, description: m.fun_nav_picker_hint },
		{ href: '/fun/match', label: m.fun_nav_match, description: m.fun_nav_match_hint },
		{ href: '/fun/gallery', label: m.fun_nav_gallery, description: m.fun_nav_gallery_hint },
		{ href: '/fun/session', label: m.fun_nav_session, description: m.fun_nav_session_hint }
	] as const;

	function active(href: string): boolean {
		return href === '/fun' ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<header class="overflow-hidden rounded-xl border border-border bg-background">
		<div class="border-b border-border px-5 py-5 sm:px-7">
			<p class="text-xs font-semibold tracking-[0.24em] text-accent-300">{m.fun_title()}</p>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight text-white">{m.fun_hub_title()}</h1>
			<p class="mt-1 max-w-2xl text-sm text-text-muted">{m.fun_hub_subtitle()}</p>
		</div>
		<nav aria-label={m.fun_nav_label()} class="grid gap-px bg-surface-raised sm:grid-cols-4">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={active(link.href) ? 'page' : undefined}
					class="group bg-background px-4 py-3 transition hover:bg-surface {active(link.href)
						? 'shadow-[inset_0_-2px_0_0_var(--color-accent-500)]'
						: ''}"
				>
					<span
						class="block text-sm font-medium {active(link.href)
							? 'text-white'
							: 'text-text-secondary'}"
					>
						{link.label()}
					</span>
					<span class="mt-0.5 block text-xs text-text-faint group-hover:text-text-muted">
						{link.description()}
					</span>
				</a>
			{/each}
		</nav>
	</header>

	{@render children()}
</div>

<script lang="ts">
	/** The theme grid: built-ins grouped by family, then the user's own themes. */
	import { m } from '$lib/paraglide/messages';
	import { BUILTIN_THEMES, findBuiltinTheme } from '$lib/theming/presets';
	import type { CustomTheme } from '$lib/theming/schema';
	import ThemeTile from './ThemeTile.svelte';

	let {
		themeId,
		customThemes,
		onSelect,
		onExport
	}: {
		themeId: string;
		customThemes: CustomTheme[];
		onSelect: (id: string) => void;
		onExport: (theme: CustomTheme) => void;
	} = $props();

	const themeGroups = [
		{
			key: 'base',
			label: m.appearance_themes_base,
			themes: BUILTIN_THEMES.filter((t) => t.family === 'base')
		},
		{
			key: 'extreme',
			label: m.appearance_themes_extreme,
			themes: BUILTIN_THEMES.filter((t) => t.family === 'extreme')
		}
	];

	/** Ring the active tile. */
	function selected(id: string): string {
		return themeId === id ? 'border-accent-500 ring-1 ring-accent-500' : '';
	}
</script>

<div class="space-y-4">
	{#each themeGroups as group (group.key)}
		<div>
			<h3 class="mb-2 text-xs font-semibold tracking-wide text-text-faint uppercase">
				{group.label()}
			</h3>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each group.themes as theme (theme.id)}
					<button
						type="button"
						onclick={() => onSelect(theme.id)}
						aria-pressed={themeId === theme.id}
						class="surface flex flex-col gap-2 p-3 text-left transition hover:border-border-hover {selected(
							theme.id
						)}"
					>
						<ThemeTile swatches={theme.swatches} name={theme.name} />
					</button>
				{/each}
			</div>
		</div>
	{/each}

	{#if customThemes.length > 0}
		<div>
			<h3 class="mb-2 text-xs font-semibold tracking-wide text-text-faint uppercase">
				{m.appearance_themes_custom()}
			</h3>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each customThemes as theme (theme.id)}
					{@const base = findBuiltinTheme(theme.base)}
					<div class="surface flex flex-col gap-2 p-3 {selected(theme.id)}">
						<button
							type="button"
							onclick={() => onSelect(theme.id)}
							aria-pressed={themeId === theme.id}
							class="flex flex-col gap-2 text-left"
						>
							<ThemeTile
								swatches={base?.swatches ?? []}
								name={theme.name}
								accentOverride={theme.tokens['accent-base'] ?? null}
							/>
							<span class="text-[10px] text-text-faint">
								{m.appearance_based_on({ base: base?.name ?? theme.base })}
								{theme.version ? ` · v${theme.version}` : ''}
							</span>
						</button>
						<span class="flex gap-1">
							<button
								type="button"
								class="btn btn-ghost px-2 py-0.5 text-[10px]"
								onclick={() => onExport(theme)}>{m.appearance_export()}</button
							>
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

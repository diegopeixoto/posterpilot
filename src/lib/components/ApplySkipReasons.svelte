<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { codes }: { codes: string[] } = $props();
</script>

{#if codes.includes('kometa_migration_required') || codes.includes('missing_kometa_identifier')}
	<div
		class="w-full space-y-1 rounded-surface border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
		role="status"
	>
		{#if codes.includes('kometa_migration_required')}
			<p>{m.apply_skip_kometa_migration_required()}</p>
		{/if}
		{#if codes.includes('missing_kometa_identifier')}
			<p>{m.apply_skip_missing_kometa_identifier()}</p>
		{/if}
	</div>
{/if}

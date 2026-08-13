<script lang="ts">
	/**
	 * One coverage status, drawn.
	 *
	 * The badge always renders its localized label as text. The glyph is
	 * `aria-hidden` decoration that repeats the label, and the tone is a hint layered
	 * on top — never the signal. Read with the stylesheet stripped, or by someone who
	 * cannot separate green from amber, the badge still says exactly which of the six
	 * states this slot is in.
	 *
	 * `exported_to_kometa` is deliberately quiet rather than green: it is a line in a
	 * metadata file, and the colour must not make the claim the wording refuses to.
	 * The sentence explaining that lives beside the group, not in here — a badge that
	 * had to carry a full caveat would stop being a badge.
	 */
	import type { CoverageStatus } from '$lib/artwork-coverage';
	import { coverageStatusPresentation, type CoverageTone } from '$lib/coverage-presentation';

	let {
		status,
		class: className = ''
	}: {
		status: CoverageStatus;
		/** Extra utilities from the caller; the tone classes still win on colour. */
		class?: string;
	} = $props();

	const presentation = $derived(coverageStatusPresentation(status));

	/**
	 * Tone to surface. Semantic colour only, per the project's palette: emerald for
	 * artwork proven to be in place, amber for "look at this", neutral for everything
	 * we merely wrote down or could not confirm. Two tones share the dashed border
	 * because a dashed edge is the non-colour way of saying "this is not solid
	 * evidence"; their labels are what tell them apart.
	 */
	function toneClass(tone: CoverageTone): string {
		switch (tone) {
			case 'covered':
				return 'border border-emerald-800 bg-emerald-950/60 text-emerald-200';
			case 'exported':
				return 'border border-border-strong bg-surface text-text-strong';
			case 'changed':
				return 'border border-amber-800 bg-amber-950/60 text-amber-200';
			case 'unverified':
				return 'border border-dashed border-amber-800 bg-amber-950/30 text-amber-200';
			case 'absent':
				return 'border border-border bg-well/40 text-text-muted';
			case 'unknown':
				return 'border border-dashed border-border-strong bg-surface/60 text-text-muted';
		}
	}
</script>

<!-- `text-xs` overrides the shared badge's 10px: this one is read to decide whether
     to reapply artwork, not glanced at on a poster tile. -->
<span
	class="badge gap-1 text-xs {toneClass(presentation.tone)} {className}"
	data-coverage-badge
	data-coverage-status={status}
	data-coverage-tone={presentation.tone}
>
	<span aria-hidden="true">{presentation.icon}</span>
	<span data-coverage-label>{presentation.label}</span>
</span>

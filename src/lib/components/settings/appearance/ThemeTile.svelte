<script lang="ts">
	/**
	 * A miniature of the app chrome, rendered in the theme the tile represents.
	 *
	 * It works because `[data-theme]` is an attribute selector: it matches any
	 * element, not just `<html>`. Putting the attribute on this tile brings the
	 * theme's whole token set *and* its reskin rules inside — the Sonarr tile
	 * really is flat with a left accent bar, the Terminal tile really is square
	 * and scanlined, because it is the same CSS the page uses rather than a
	 * hand-drawn imitation of it. Custom themes add their token deltas inline,
	 * exactly as the applier does on `<html>`.
	 *
	 * Three swatches could not show any of that; a reskin changes shape, not just
	 * color, and shape is most of what distinguishes these themes.
	 */
	let {
		dataTheme,
		vars = '',
		sidebar = false
	}: {
		/** The built-in theme id whose `[data-theme]` block styles the tile. */
		dataTheme: string;
		/** Inline `--pp-*` overrides for a custom theme's deltas. */
		vars?: string;
		/** Whether this theme's chrome is a left rail rather than a top bar. */
		sidebar?: boolean;
	} = $props();
</script>

<span
	class="theme-preview flex h-16 w-full overflow-hidden rounded-surface border border-border {sidebar
		? 'flex-row'
		: 'flex-col'}"
	data-theme={dataTheme}
	style={vars}
	aria-hidden="true"
>
	<!-- Chrome: the rail or bar the theme's layout calls for. -->
	<span
		class="flex shrink-0 gap-1 border-chrome-border bg-chrome {sidebar
			? 'h-full w-1/3 flex-col justify-start border-r p-1'
			: 'w-full items-center border-b px-1 py-1'}"
	>
		<span class="h-1 rounded-full bg-accent-600 {sidebar ? 'w-2/3' : 'w-4'}"></span>
		<span class="h-1 rounded-full bg-text-faint {sidebar ? 'w-1/2' : 'w-3'}"></span>
	</span>

	<!-- Content: a surface card and a primary action, so panel treatment and
	     button treatment both show through. -->
	<span class="flex min-w-0 flex-1 items-center gap-1.5 p-1.5">
		<span class="surface flex min-w-0 flex-1 flex-col gap-1 p-1.5">
			<span class="h-1 w-3/5 rounded-full bg-text-muted"></span>
			<span class="h-1 w-2/5 rounded-full bg-text-faint"></span>
		</span>
		<span class="btn btn-accent h-3.5 w-6 shrink-0 px-0 py-0"></span>
	</span>
</span>

<script lang="ts">
	// A shimmer placeholder. `class` sizes/shapes it (e.g. aspect-[2/3] rounded-surface).
	let { class: className = '' }: { class?: string } = $props();
</script>

<div class="skeleton {className}" aria-hidden="true"></div>

<style>
	/* Theme tokens, not fixed neutrals: a hard-coded dark shimmer left grey blocks
	   sitting on the light theme's white page. */
	.skeleton {
		background: linear-gradient(
			100deg,
			var(--pp-surface) 30%,
			var(--pp-surface-raised) 50%,
			var(--pp-surface) 70%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}
	@keyframes skeleton-shimmer {
		to {
			background-position: -200% 0;
		}
	}
	/* Motion-safety: a static muted block instead of the shimmer sweep. */
	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
			background: var(--pp-surface);
		}
	}
</style>

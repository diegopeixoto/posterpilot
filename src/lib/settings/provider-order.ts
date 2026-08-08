/**
 * Reorder arithmetic behind the canonical provider-order control in Settings →
 * Providers. Kept out of the component because the repo has no DOM testing library:
 * whatever stays in `.svelte` is untested, so the move/drop maths lives here.
 *
 * Mirrors `ArtworkProviderId` from `$lib/server/posters/score`, which the browser
 * bundle cannot import (`$lib/server` is server-only).
 */
export const RANKING_PROVIDERS = ['mediux', 'theposterdb', 'fanarttv', 'tmdb'] as const;

export type RankingProvider = (typeof RANKING_PROVIDERS)[number];

/** Brand names, deliberately untranslated — they are product names, not copy. */
export const RANKING_PROVIDER_LABELS: Record<RankingProvider, string> = {
	mediux: 'MediUX',
	theposterdb: 'ThePosterDB',
	fanarttv: 'Fanart.tv',
	tmdb: 'TMDB'
};

/** One row's vertical extent in viewport coordinates, as `getBoundingClientRect` reports it. */
export interface ProviderRowBounds {
	top: number;
	height: number;
}

/**
 * Move the provider at `from` to `to`, clamping `to` inside the list. Always returns a
 * new array so a caller can assign it straight to `$state` and let Svelte see the change;
 * an out-of-range or no-op move returns an unchanged copy.
 */
export function reorderProviders(
	order: readonly RankingProvider[],
	from: number,
	to: number
): RankingProvider[] {
	const next = [...order];
	if (next.length === 0 || from < 0 || from >= next.length) return next;
	const target = Math.min(Math.max(to, 0), next.length - 1);
	if (target === from) return next;
	const [moved] = next.splice(from, 1);
	next.splice(target, 0, moved);
	return next;
}

/**
 * Single-step move for the ↑/↓ buttons. At either bound the clamp makes this a no-op,
 * which is what lets the caller detect "nothing changed" and skip the announcement.
 */
export function moveProvider(
	order: readonly RankingProvider[],
	from: number,
	delta: -1 | 1
): RankingProvider[] {
	return reorderProviders(order, from, from + delta);
}

/**
 * Index a dragged row would land on for a pointer at `pointerY`, using each row's own
 * midpoint as the crossing threshold so tall and short rows behave the same. Pointers
 * above the first row or below the last clamp to the ends; an empty list yields -1.
 */
export function dropIndexForPointer(pointerY: number, rows: readonly ProviderRowBounds[]): number {
	if (rows.length === 0) return -1;
	for (let index = 0; index < rows.length; index += 1) {
		if (pointerY < rows[index].top + rows[index].height / 2) return index;
	}
	return rows.length - 1;
}

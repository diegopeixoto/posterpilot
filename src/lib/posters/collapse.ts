/**
 * Collapse-state helpers for the item-detail view's provider / set / season
 * sections. State is a set of "expanded" keys; absence means collapsed. The pure
 * pieces (key builders + default seeding) live here so they can be unit-tested;
 * the `.svelte` view owns the localStorage read/write.
 */

/** Stable key for a provider section. */
export function providerKey(provider: string): string {
	return `p:${provider}`;
}

/** Stable key for a set card. */
export function setKey(setId: string): string {
	return `s:${setId}`;
}

/** Stable key for a season group within a set. */
export function seasonKey(setId: string, season: number): string {
	return `season:${setId}:${season}`;
}

/** A provider group shape sufficient to seed defaults. */
export interface SeedGroup {
	provider: string;
	sets: { setId: string }[];
}

/**
 * Default expanded keys for a fresh item: the first provider and its first set are
 * expanded; everything else (other providers, other sets, all season groups) stays
 * collapsed.
 */
export function defaultExpanded(groups: SeedGroup[]): Set<string> {
	const expanded = new Set<string>();
	const first = groups[0];
	if (first) {
		expanded.add(providerKey(first.provider));
		if (first.sets[0]) expanded.add(setKey(first.sets[0].setId));
	}
	return expanded;
}

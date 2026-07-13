/** Small deterministic hash (FNV-1a) suitable for ranking ids, not for security. */
export function funSeedHash(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Reproducibly order eligible items for a seed without mutating the input array. */
export function rankFunItems<T extends { id: number }>(items: readonly T[], seed: string): T[] {
	return [...items].sort(
		(a, b) => funSeedHash(`${seed}:${a.id}`) - funSeedHash(`${seed}:${b.id}`) || a.id - b.id
	);
}

/** Stable id used by share/re-roll/session state. */
export function funResultId(seed: string, itemIds: readonly number[]): string {
	return funSeedHash(`${seed}:${itemIds.join(',')}`).toString(36);
}

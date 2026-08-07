import { isMap, isScalar, type Pair, type YAMLMap } from 'yaml';

export function isYamlNull(node: unknown): boolean {
	return node === null || (isScalar(node) && node.value === null);
}

/** Return the plain scalar value without resolving aliases or expanding YAML. */
export function yamlKeyValue(key: unknown): unknown {
	return isScalar(key) ? key.value : key;
}

/** Find one logical key while rejecting numeric/string aliases such as 101 and "101". */
export function findLogicalPair(map: YAMLMap, key: string | number): Pair | undefined {
	let match: Pair | undefined;
	for (const pair of map.items) {
		if (String(yamlKeyValue(pair.key)) !== String(key)) continue;
		if (match) throw new Error('Ambiguous existing Kometa YAML keys');
		match = pair;
	}
	return match;
}

function assertUniqueLogicalKeys(map: YAMLMap): void {
	const seen = new Set<string>();
	for (const pair of map.items) {
		const key = String(yamlKeyValue(pair.key));
		if (seen.has(key)) throw new Error('Ambiguous existing Kometa YAML keys');
		seen.add(key);
	}
}

function assertStringSlot(map: YAMLMap, key: 'url_poster' | 'url_background'): void {
	const pair = findLogicalPair(map, key);
	if (!pair || isYamlNull(pair.value)) return;
	if (!isScalar(pair.value) || typeof pair.value.value !== 'string') {
		throw new Error('Existing Kometa YAML slot is not a string scalar');
	}
}

function requiredManagedMap(value: unknown): YAMLMap | null {
	if (isYamlNull(value)) return null;
	if (!isMap(value)) throw new Error('Existing Kometa YAML node is not a mapping');
	return value;
}

/** Reject logical aliases throughout the PosterPilot-managed Kometa metadata tree. */
export function assertManagedLogicalKeys(metadata: YAMLMap): void {
	assertUniqueLogicalKeys(metadata);
	for (const metadataPair of metadata.items) {
		const entry = requiredManagedMap(metadataPair.value);
		if (!entry) continue;
		assertUniqueLogicalKeys(entry);
		assertStringSlot(entry, 'url_poster');
		assertStringSlot(entry, 'url_background');
		const seasonsPair = findLogicalPair(entry, 'seasons');
		if (!seasonsPair) continue;
		const seasons = requiredManagedMap(seasonsPair.value);
		if (!seasons) continue;
		assertUniqueLogicalKeys(seasons);
		for (const seasonPair of seasons.items) {
			const season = requiredManagedMap(seasonPair.value);
			if (!season) continue;
			assertUniqueLogicalKeys(season);
			assertStringSlot(season, 'url_poster');
			assertStringSlot(season, 'url_background');
			const episodesPair = findLogicalPair(season, 'episodes');
			if (!episodesPair) continue;
			const episodes = requiredManagedMap(episodesPair.value);
			if (!episodes) continue;
			assertUniqueLogicalKeys(episodes);
			for (const episodePair of episodes.items) {
				const episode = requiredManagedMap(episodePair.value);
				if (!episode) continue;
				assertUniqueLogicalKeys(episode);
				assertStringSlot(episode, 'url_poster');
			}
		}
	}
}

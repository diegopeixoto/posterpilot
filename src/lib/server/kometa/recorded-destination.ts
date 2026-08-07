import {
	isKometaDestinationV2,
	isKometaLegacyDestinationV1,
	legacyKometaDestinationKey,
	parseKometaLegacyDestinationKey,
	type KometaDestinationV2,
	type KometaLegacyDestinationV1
} from './destination';

export type RecordedKometaDestination = KometaDestinationV2 | KometaLegacyDestinationV1;

function recordField(value: unknown, key: string): unknown {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/**
 * Recover only a destination explicitly persisted by a released writer.
 *
 * Pre-split snapshots stored just `{ tmdbId }`; at that time the writer always
 * targeted `posterpilot.yml`, so that historical shape proves the exact V1 path.
 * Conflicting records fail closed instead of choosing one.
 */
export function recordedKometaDestination(
	provenance: Record<string, unknown> | null,
	metadata: Record<string, unknown> | null
): RecordedKometaDestination | null {
	const historicalTmdbId = recordField(metadata, 'tmdbId');
	const historical =
		typeof historicalTmdbId === 'string'
			? parseKometaLegacyDestinationKey(legacyKometaDestinationKey(historicalTmdbId))
			: null;
	const candidates = [
		recordField(provenance, 'kometaDestination'),
		recordField(metadata, 'kometaDestination'),
		recordField(provenance, 'legacyKometaDestination'),
		recordField(metadata, 'legacyKometaDestination'),
		historical
	].filter(
		(candidate): candidate is RecordedKometaDestination =>
			isKometaDestinationV2(candidate) || isKometaLegacyDestinationV1(candidate)
	);
	if (candidates.length === 0) return null;
	const [first] = candidates;
	return candidates.every((candidate) => candidate.key === first.key) ? first : null;
}

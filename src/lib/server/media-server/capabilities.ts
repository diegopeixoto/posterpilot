import type {
	CapabilitySupport,
	MediaServerCapabilities,
	MediaServerIdentity,
	ServerType
} from './types';

const EVIDENCE = new Set<MediaServerCapabilities['evidence']>([
	'provider_contract',
	'advertised',
	'verified',
	'unknown'
]);

function support(value: unknown, fallback: CapabilitySupport): CapabilitySupport {
	if (value === true || value === 'supported') return 'supported';
	if (value === false || value === 'unsupported') return 'unsupported';
	if (value === 'unknown') return 'unknown';
	return fallback;
}

/** Provider contracts are conservative: unsupported operations stay explicit. */
export function defaultMediaServerCapabilities(type: ServerType): MediaServerCapabilities {
	return {
		posterWrite: 'supported',
		backgroundWrite: 'supported',
		seasonWrite: 'supported',
		episodeWrite: 'supported',
		fieldLock: type === 'plex' ? 'supported' : 'unsupported',
		currentImageRetrieval: 'supported',
		artworkDelete: type === 'plex' ? 'unsupported' : 'supported',
		nativeCollectionDiscovery: 'supported',
		collectionArtwork: 'supported',
		evidence: 'provider_contract',
		limitations: type === 'plex' ? ['artwork_delete_unavailable'] : ['field_lock_not_applicable']
	};
}

/** Merge stored advertised/verified values into the conservative provider contract. */
export function normalizeMediaServerCapabilities(
	type: ServerType,
	value: Record<string, unknown> | null | undefined
): MediaServerCapabilities {
	const fallback = defaultMediaServerCapabilities(type);
	if (!value) return fallback;
	const rawEvidence = value.evidence;
	const evidence =
		typeof rawEvidence === 'string' &&
		EVIDENCE.has(rawEvidence as MediaServerCapabilities['evidence'])
			? (rawEvidence as MediaServerCapabilities['evidence'])
			: fallback.evidence;
	return {
		posterWrite: support(value.posterWrite, fallback.posterWrite),
		backgroundWrite: support(value.backgroundWrite, fallback.backgroundWrite),
		seasonWrite: support(value.seasonWrite, fallback.seasonWrite),
		episodeWrite: support(value.episodeWrite, fallback.episodeWrite),
		fieldLock: support(value.fieldLock, fallback.fieldLock),
		currentImageRetrieval: support(value.currentImageRetrieval, fallback.currentImageRetrieval),
		artworkDelete: support(value.artworkDelete, fallback.artworkDelete),
		nativeCollectionDiscovery: support(
			value.nativeCollectionDiscovery,
			fallback.nativeCollectionDiscovery ?? 'unknown'
		),
		collectionArtwork: support(value.collectionArtwork, fallback.collectionArtwork ?? 'unknown'),
		evidence,
		limitations: Array.isArray(value.limitations)
			? value.limitations.filter((entry): entry is string => typeof entry === 'string')
			: fallback.limitations
	};
}

export function mediaServerIdentity(
	type: ServerType,
	instanceId?: string | null,
	name?: string | null
): MediaServerIdentity {
	return { type, instanceId: instanceId || null, name: name?.trim() || null };
}

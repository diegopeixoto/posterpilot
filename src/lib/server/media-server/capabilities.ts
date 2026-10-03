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
		// Jellyfin/Emby lock via the item-level `LockData` flag (no per-image lock
		// exists); Plex locks the artwork fields directly. Both protect applied
		// artwork from the server's automatic metadata agents.
		fieldLock: 'supported',
		currentImageRetrieval: 'supported',
		artworkDelete: type === 'plex' ? 'unsupported' : 'supported',
		nativeCollectionDiscovery: 'supported',
		collectionArtwork: 'supported',
		evidence: 'provider_contract',
		limitations:
			type === 'plex'
				? ['artwork_delete_unavailable']
				: ['field_lock_item_level', 'field_lock_blocks_item_metadata_refresh']
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
		// fieldLock is a shipped code contract, not a discovered capability: older
		// stored snapshots predate the Jellyfin/Emby LockData implementation and
		// claim "unsupported". A stale cache must not keep locking disabled, so the
		// contract always wins for this field.
		fieldLock: fallback.fieldLock,
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

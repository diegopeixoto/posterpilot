import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkRevisions, artworkSnapshots, mediaItems } from '$lib/server/db/schema';
import { applySlotKey, type ApplySlot } from '$lib/server/plans/apply-plan';
import { kometaSlotFingerprint } from '$lib/server/revisions/kometa-state';
import type {
	AuthoritativeKometaMapping,
	NormalizedLegacyRevisionEvidence
} from './migration-classifier';
import { LEGACY_METADATA_LIMITS, compareCodeUnitStrings } from './migration-classifier';
import { recordedKometaDestination } from './recorded-destination';

export type KometaMigrationEvidenceDatabase = Pick<LibSQLDatabase<typeof schema>, 'select'>;

export interface KometaMigrationEvidence {
	/** Active items, eligible for direct legacy-key classification. */
	mappings: AuthoritativeKometaMapping[];
	/** Scoped identities attached to accepted revision evidence, including tombstones. */
	revisionMappings: AuthoritativeKometaMapping[];
	revisions: NormalizedLegacyRevisionEvidence[];
}

export class KometaMigrationEvidenceError extends Error {
	constructor(readonly code: 'migration_evidence_limit_exceeded') {
		super(code);
		this.name = 'KometaMigrationEvidenceError';
	}
}

function assertServerInstanceId(serverInstanceId: string): void {
	if (
		serverInstanceId.length === 0 ||
		serverInstanceId.trim() !== serverInstanceId ||
		new TextEncoder().encode(serverInstanceId).byteLength > 256
	) {
		throw new TypeError('Invalid server instance id');
	}
}

function boundedIdentifier(value: string | null): string | null {
	return value !== null && new TextEncoder().encode(value).byteLength <= 256 ? value : null;
}

function normalizedSlot(
	kind: string,
	season: number | null,
	episode: number | null
): ApplySlot | null {
	if (kind !== 'poster' && kind !== 'background' && kind !== 'title_card') return null;
	if (season !== null && (!Number.isSafeInteger(season) || season < 0)) return null;
	if (episode !== null && (!Number.isSafeInteger(episode) || episode < 0)) return null;
	if (kind === 'title_card') {
		return season !== null && episode !== null ? { kind, season, episode } : null;
	}
	return episode === null ? { kind, season, episode: null } : null;
}

function sameNullableInteger(left: number | null, right: number | null): boolean {
	return left === right;
}

function presentSnapshotValue(value: unknown): { state: 'present'; url: string } | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	return candidate.state === 'present' &&
		typeof candidate.url === 'string' &&
		candidate.url.length > 0
		? { state: 'present', url: candidate.url }
		: null;
}

/**
 * Load the bounded server-side evidence consumed by the pure legacy classifier.
 *
 * Full artwork URLs are used only long enough to verify their fingerprint and
 * are never returned or logged by this repository.
 */
export async function loadKometaMigrationEvidence(
	database: KometaMigrationEvidenceDatabase,
	serverInstanceId: string
): Promise<KometaMigrationEvidence> {
	assertServerInstanceId(serverInstanceId);

	const activeItems = await database
		.select({
			mediaItemId: mediaItems.id,
			type: mediaItems.type,
			tmdbId: mediaItems.tmdbId,
			tvdbId: mediaItems.tvdbId,
			imdbId: mediaItems.imdbId
		})
		.from(mediaItems)
		.where(
			and(eq(mediaItems.serverInstanceId, serverInstanceId), isNull(mediaItems.sourceRemovedAt))
		)
		.orderBy(asc(mediaItems.id))
		.limit(LEGACY_METADATA_LIMITS.maxMappings + 1);
	if (activeItems.length > LEGACY_METADATA_LIMITS.maxMappings) {
		throw new KometaMigrationEvidenceError('migration_evidence_limit_exceeded');
	}

	const mappings = activeItems.flatMap((item): AuthoritativeKometaMapping[] => {
		if (
			!Number.isSafeInteger(item.mediaItemId) ||
			item.mediaItemId <= 0 ||
			(item.type !== 'movie' && item.type !== 'show')
		) {
			return [];
		}
		return [
			{
				mediaItemId: item.mediaItemId,
				type: item.type,
				tmdbId: boundedIdentifier(item.tmdbId),
				tvdbId: boundedIdentifier(item.tvdbId),
				imdbId: boundedIdentifier(item.imdbId)
			}
		];
	});
	const rows = await database
		.select({
			revisionId: artworkRevisions.id,
			revisionServerInstanceId: artworkRevisions.serverInstanceId,
			revisionMediaItemId: artworkRevisions.mediaItemId,
			revisionMediaCollectionId: artworkRevisions.mediaCollectionId,
			revisionKind: artworkRevisions.kind,
			revisionSeason: artworkRevisions.season,
			revisionEpisode: artworkRevisions.episode,
			revisionProvenance: artworkRevisions.provenance,
			proposedFingerprint: artworkRevisions.proposedFingerprint,
			itemServerInstanceId: mediaItems.serverInstanceId,
			itemType: mediaItems.type,
			itemTmdbId: mediaItems.tmdbId,
			itemTvdbId: mediaItems.tvdbId,
			itemImdbId: mediaItems.imdbId,
			snapshotServerInstanceId: artworkSnapshots.serverInstanceId,
			snapshotMediaItemId: artworkSnapshots.mediaItemId,
			snapshotMediaCollectionId: artworkSnapshots.mediaCollectionId,
			snapshotDestination: artworkSnapshots.destination,
			snapshotKind: artworkSnapshots.kind,
			snapshotSeason: artworkSnapshots.season,
			snapshotEpisode: artworkSnapshots.episode,
			snapshotState: artworkSnapshots.state,
			snapshotValue: artworkSnapshots.value,
			snapshotMetadata: artworkSnapshots.metadata
		})
		.from(artworkRevisions)
		.innerJoin(artworkSnapshots, eq(artworkSnapshots.id, artworkRevisions.afterSnapshotId))
		.innerJoin(mediaItems, eq(mediaItems.id, artworkRevisions.mediaItemId))
		.where(
			and(
				eq(artworkRevisions.serverInstanceId, serverInstanceId),
				eq(artworkRevisions.action, 'apply'),
				eq(artworkRevisions.destination, 'kometa'),
				eq(artworkRevisions.outcome, 'success'),
				eq(artworkRevisions.verification, 'exact'),
				isNotNull(artworkRevisions.mediaItemId),
				isNotNull(artworkRevisions.afterSnapshotId),
				eq(mediaItems.serverInstanceId, serverInstanceId)
			)
		)
		.orderBy(asc(artworkRevisions.id))
		.limit(LEGACY_METADATA_LIMITS.maxRevisionEvidence + 1);
	if (rows.length > LEGACY_METADATA_LIMITS.maxRevisionEvidence) {
		throw new KometaMigrationEvidenceError('migration_evidence_limit_exceeded');
	}

	const revisions: NormalizedLegacyRevisionEvidence[] = [];
	const revisionMappingsByItemId = new Map<number, AuthoritativeKometaMapping>();
	for (const row of rows) {
		const mediaItemId = row.revisionMediaItemId;
		if (
			mediaItemId === null ||
			!Number.isSafeInteger(mediaItemId) ||
			mediaItemId <= 0 ||
			row.revisionServerInstanceId !== serverInstanceId ||
			row.itemServerInstanceId !== serverInstanceId ||
			(row.itemType !== 'movie' && row.itemType !== 'show') ||
			row.snapshotServerInstanceId !== serverInstanceId ||
			row.snapshotMediaItemId !== mediaItemId ||
			row.revisionMediaCollectionId !== null ||
			row.snapshotMediaCollectionId !== null ||
			row.snapshotDestination !== 'kometa' ||
			row.snapshotState !== 'present' ||
			row.snapshotKind !== row.revisionKind ||
			!sameNullableInteger(row.snapshotSeason, row.revisionSeason) ||
			!sameNullableInteger(row.snapshotEpisode, row.revisionEpisode)
		) {
			continue;
		}

		const slot = normalizedSlot(row.revisionKind, row.revisionSeason, row.revisionEpisode);
		const snapshotValue = presentSnapshotValue(row.snapshotValue);
		if (!slot || !snapshotValue) continue;

		const destination = recordedKometaDestination(row.revisionProvenance, row.snapshotMetadata);
		if (destination?.version !== 1) continue;

		const observedFingerprint = kometaSlotFingerprint(snapshotValue);
		const proposedFingerprint = row.proposedFingerprint ?? observedFingerprint;
		if (proposedFingerprint !== observedFingerprint) continue;

		revisions.push({
			revisionId: row.revisionId,
			mediaItemId,
			legacyMappingId: destination.mappingId,
			slot,
			proposedFingerprint
		});
		revisionMappingsByItemId.set(mediaItemId, {
			mediaItemId,
			type: row.itemType,
			tmdbId: boundedIdentifier(row.itemTmdbId),
			tvdbId: boundedIdentifier(row.itemTvdbId),
			imdbId: boundedIdentifier(row.itemImdbId)
		});
	}
	const revisionMappings = [...revisionMappingsByItemId.values()];
	if (revisionMappings.length > LEGACY_METADATA_LIMITS.maxMappings) {
		throw new KometaMigrationEvidenceError('migration_evidence_limit_exceeded');
	}

	revisions.sort(
		(left, right) =>
			compareCodeUnitStrings(left.legacyMappingId, right.legacyMappingId) ||
			compareCodeUnitStrings(applySlotKey(left.slot), applySlotKey(right.slot)) ||
			left.mediaItemId - right.mediaItemId ||
			compareCodeUnitStrings(left.revisionId, right.revisionId)
	);
	revisionMappings.sort((left, right) => left.mediaItemId - right.mediaItemId);

	return { mappings, revisionMappings, revisions };
}

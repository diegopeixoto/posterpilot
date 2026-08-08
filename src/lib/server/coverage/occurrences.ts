/**
 * Canonical occurrence grouping for artwork coverage.
 *
 * One title is usually several rows: the same film on two servers, or twice on
 * one server because it sits in both `Movies` and `Movies 4K`. Coverage is
 * always derived per occurrence — a poster applied on one server proves nothing
 * about the copy in the other library — but the UI still needs to talk about
 * "this title" across them.
 *
 * The bridge is `canonicalIdentityKey`: authoritative media kind plus TMDB id,
 * and nothing else. Titles and years never join two rows. Two restorations of
 * *Nosferatu (1922)* are two TMDB titles, and an unresolved row carries no
 * evidence that it is either of them, so it is grouped alone.
 */

import { canonicalIdentityKey, type CanonicalMediaKind } from '$lib/artwork-coverage';

/** The `media_items` columns coverage grouping reads. */
export interface CoverageOccurrenceInput {
	serverInstanceId: string;
	mediaItemId: number;
	/** `media_items.section_key` — the library this copy lives in. */
	librarySectionKey: string;
	/** `media_items.media_type`: the kind resolved against TMDB, null until resolved. */
	mediaType: CanonicalMediaKind | null;
	/** `media_items.tmdb_id`, null until resolved. */
	tmdbId: string | null;
	/** `media_items.source_removed_at`: non-null once the copy left its library. */
	sourceRemovedAt?: Date | null;
}

/** One concrete copy, with the provenance needed to say *where* it is covered. */
export interface CoverageOccurrence {
	occurrenceKey: string;
	serverInstanceId: string;
	mediaItemId: number;
	librarySectionKey: string;
	/** Canonical identity, or `null` for an unresolved copy. */
	identityKey: string | null;
	mediaType: CanonicalMediaKind | null;
	tmdbId: string | null;
}

/** Active copies that share one canonical identity, or a lone unresolved copy. */
export interface CoverageIdentityGroup {
	/** `movie:105`, `tv:105`, or an occurrence-private key for an unresolved copy. */
	key: string;
	/** False when the group exists only because the copy has no canonical identity. */
	resolved: boolean;
	kind: CanonicalMediaKind | null;
	tmdbId: string | null;
	occurrences: CoverageOccurrence[];
	/** Distinct servers this title is known to occur on. */
	serverInstanceIds: string[];
	/** Distinct `serverInstanceId`/`librarySectionKey` pairs, in occurrence order. */
	libraryCount: number;
}

/**
 * Stable key for one copy.
 *
 * JSON-encoded rather than delimiter-joined because `serverInstanceId` is opaque
 * text: a server whose id contained the delimiter could otherwise collide with a
 * different server's item.
 */
export function coverageOccurrenceKey(serverInstanceId: string, mediaItemId: number): string {
	return JSON.stringify([serverInstanceId, mediaItemId]);
}

/**
 * Whether a copy still exists in its library.
 *
 * A removed copy's server serves nothing for it, so counting it would report
 * coverage for a title the user can no longer see.
 */
export function isActiveOccurrence(input: CoverageOccurrenceInput): boolean {
	return input.sourceRemovedAt === null || input.sourceRemovedAt === undefined;
}

/** Project one row into its occurrence, resolving canonical identity once. */
export function toCoverageOccurrence(input: CoverageOccurrenceInput): CoverageOccurrence {
	return {
		occurrenceKey: coverageOccurrenceKey(input.serverInstanceId, input.mediaItemId),
		serverInstanceId: input.serverInstanceId,
		mediaItemId: input.mediaItemId,
		librarySectionKey: input.librarySectionKey,
		identityKey: canonicalIdentityKey(input.mediaType, input.tmdbId),
		mediaType: input.mediaType,
		tmdbId: input.tmdbId
	};
}

function compareOccurrences(a: CoverageOccurrence, b: CoverageOccurrence): number {
	return (
		a.serverInstanceId.localeCompare(b.serverInstanceId) ||
		a.librarySectionKey.localeCompare(b.librarySectionKey) ||
		a.mediaItemId - b.mediaItemId
	);
}

/**
 * Relate active copies under one canonical identity while keeping every
 * occurrence's server and library.
 *
 * Movie and show identities stay apart because the kind is part of the key, so
 * TMDB movie 105 and TMDB show 105 produce `movie:105` and `tv:105`. An
 * unresolved copy gets a group of its own keyed by the occurrence, which is what
 * makes "keeps only its own evidence" structural rather than a rule someone has
 * to remember downstream.
 *
 * Duplicate rows for one `(server, media item)` collapse to the first; the pair
 * is unique in `media_items`, so a repeat is a caller mistake, not two copies.
 */
export function groupOccurrencesByIdentity(
	inputs: readonly CoverageOccurrenceInput[]
): CoverageIdentityGroup[] {
	const seen = new Set<string>();
	const groups = new Map<string, CoverageIdentityGroup>();

	for (const input of inputs) {
		if (!isActiveOccurrence(input)) continue;
		const occurrence = toCoverageOccurrence(input);
		if (seen.has(occurrence.occurrenceKey)) continue;
		seen.add(occurrence.occurrenceKey);

		const key = occurrence.identityKey ?? `occurrence:${occurrence.occurrenceKey}`;
		const group = groups.get(key);
		if (group) {
			group.occurrences.push(occurrence);
			continue;
		}
		groups.set(key, {
			key,
			resolved: occurrence.identityKey !== null,
			kind: occurrence.identityKey === null ? null : occurrence.mediaType,
			tmdbId: occurrence.identityKey === null ? null : occurrence.tmdbId,
			occurrences: [occurrence],
			serverInstanceIds: [],
			libraryCount: 0
		});
	}

	return [...groups.values()]
		.map((group) => {
			group.occurrences.sort(compareOccurrences);
			return {
				...group,
				serverInstanceIds: [...new Set(group.occurrences.map((o) => o.serverInstanceId))],
				libraryCount: new Set(
					group.occurrences.map((o) => JSON.stringify([o.serverInstanceId, o.librarySectionKey]))
				).size
			};
		})
		.sort((a, b) => a.key.localeCompare(b.key));
}

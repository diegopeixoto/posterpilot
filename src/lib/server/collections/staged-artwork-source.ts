import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { posterCandidates, type MediaItem } from '$lib/server/db/schema';
import { resolveStagedArtworkPreview } from '$lib/server/posters/selection-preview';

type Database = LibSQLDatabase<typeof schema>;
type RootSelectionItem = Pick<
	MediaItem,
	| 'id'
	| 'serverInstanceId'
	| 'selectedPosterUrl'
	| 'selectedBackgroundUrl'
	| 'selectedPosterCandidateId'
	| 'selectedBackgroundCandidateId'
	| 'selectedPosterProvider'
	| 'selectedBackgroundProvider'
>;

/**
 * Resolve the browser-sized source for a staged root slot without trusting a
 * candidate id on its own. Inactive candidates remain valid provenance for an
 * already-staged selection, but custom URLs never inherit candidate metadata.
 */
export async function resolveStagedRootArtworkSource(
	database: Database,
	item: RootSelectionItem,
	kind: 'poster' | 'background'
): Promise<string | null> {
	const selection =
		kind === 'poster'
			? {
					url: item.selectedPosterUrl,
					candidateId: item.selectedPosterCandidateId,
					provider: item.selectedPosterProvider
				}
			: {
					url: item.selectedBackgroundUrl,
					candidateId: item.selectedBackgroundCandidateId,
					provider: item.selectedBackgroundProvider
				};
	if (!selection.url || selection.provider === 'custom') return selection.url;

	let candidateIdentity: SQL;
	if (selection.candidateId !== null) {
		candidateIdentity = eq(posterCandidates.id, selection.candidateId);
	} else if (selection.provider) {
		// Legacy selections can have a proven provider but no candidate id. Loading
		// this one item's root/provider rows lets the URL matcher recognize TMDB
		// size variants without admitting another provider or item.
		candidateIdentity = eq(posterCandidates.provider, selection.provider);
	} else {
		candidateIdentity = eq(posterCandidates.url, selection.url);
	}

	const candidates = await database
		.select({
			id: posterCandidates.id,
			mediaItemId: posterCandidates.mediaItemId,
			url: posterCandidates.url,
			previewUrl: posterCandidates.previewUrl,
			kind: posterCandidates.kind,
			provider: posterCandidates.provider
		})
		.from(posterCandidates)
		.where(
			and(
				eq(posterCandidates.serverInstanceId, item.serverInstanceId),
				eq(posterCandidates.mediaItemId, item.id),
				eq(posterCandidates.kind, kind),
				isNull(posterCandidates.season),
				isNull(posterCandidates.episode),
				candidateIdentity
			)
		);

	return resolveStagedArtworkPreview(candidates, {
		mediaItemId: item.id,
		kind,
		...selection
	});
}

export function getStagedRootArtworkSource(
	item: RootSelectionItem,
	kind: 'poster' | 'background'
): Promise<string | null> {
	return resolveStagedRootArtworkSource(db, item, kind);
}

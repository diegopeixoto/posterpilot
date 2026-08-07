import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import type { MediaItem } from '$lib/server/db/schema';
import { resolveStagedArtworkPreview } from '$lib/server/posters/selection-preview';
import {
	loadStagedRootCandidateBuckets,
	stagedRootSelectionKey
} from '$lib/server/posters/staged-root-candidates';

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
	const stagedSelection = {
		mediaItemId: item.id,
		kind,
		...selection
	};
	const candidates = await loadStagedRootCandidateBuckets(database, item.serverInstanceId, [
		stagedSelection
	]);

	return resolveStagedArtworkPreview(
		candidates.get(stagedRootSelectionKey(item.id, kind)) ?? [],
		stagedSelection
	);
}

export function getStagedRootArtworkSource(
	item: RootSelectionItem,
	kind: 'poster' | 'background'
): Promise<string | null> {
	return resolveStagedRootArtworkSource(db, item, kind);
}

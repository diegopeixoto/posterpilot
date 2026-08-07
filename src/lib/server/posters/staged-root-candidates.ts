import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { posterCandidates } from '$lib/server/db/schema';
import type { RootArtworkKind, StagedArtworkSelection } from './selection-preview';

type Database = LibSQLDatabase<typeof schema>;

export type StagedRootSelection = StagedArtworkSelection;

export interface StagedRootCandidate {
	id: number;
	mediaItemId: number;
	url: string;
	previewUrl: string | null;
	kind: RootArtworkKind;
	provider: string;
	setId: string;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
}

const SELECTION_CHUNK_SIZE = 50;

export function stagedRootSelectionKey(mediaItemId: number, kind: RootArtworkKind): string {
	return `${mediaItemId}:${kind}`;
}

function selectionScope(selection: StagedRootSelection): SQL | null {
	if (!selection.url || selection.provider === 'custom') return null;
	const provenanceScope = selection.provider
		? eq(posterCandidates.provider, selection.provider)
		: or(eq(posterCandidates.url, selection.url), eq(posterCandidates.provider, 'tmdb'));
	return and(
		eq(posterCandidates.mediaItemId, selection.mediaItemId),
		eq(posterCandidates.kind, selection.kind),
		provenanceScope
	)!;
}

/**
 * Load only candidates that could prove the supplied root selections. Queries are
 * chunked below SQLite's parameter ceiling and deliberately include inactive rows,
 * since rediscovery may retire the row that still proves a staged selection.
 */
export async function loadStagedRootCandidateBuckets(
	database: Database,
	serverInstanceId: string,
	selections: readonly StagedRootSelection[]
): Promise<Map<string, StagedRootCandidate[]>> {
	const scopedSelections = selections
		.map((selection) => ({ selection, scope: selectionScope(selection) }))
		.filter(
			(entry): entry is { selection: StagedRootSelection; scope: SQL } => entry.scope !== null
		);
	const buckets = new Map<string, StagedRootCandidate[]>();

	for (let offset = 0; offset < scopedSelections.length; offset += SELECTION_CHUNK_SIZE) {
		const chunk = scopedSelections.slice(offset, offset + SELECTION_CHUNK_SIZE);
		const rows = await database
			.select({
				id: posterCandidates.id,
				mediaItemId: posterCandidates.mediaItemId,
				url: posterCandidates.url,
				previewUrl: posterCandidates.previewUrl,
				kind: posterCandidates.kind,
				provider: posterCandidates.provider,
				setId: posterCandidates.setId,
				setAuthor: posterCandidates.setAuthor,
				designFamily: posterCandidates.designFamily,
				language: posterCandidates.language
			})
			.from(posterCandidates)
			.where(
				and(
					eq(posterCandidates.serverInstanceId, serverInstanceId),
					isNull(posterCandidates.season),
					isNull(posterCandidates.episode),
					or(...chunk.map((entry) => entry.scope))
				)
			)
			.orderBy(asc(posterCandidates.id));

		for (const candidate of rows) {
			if (candidate.kind !== 'poster' && candidate.kind !== 'background') continue;
			const rootCandidate: StagedRootCandidate = { ...candidate, kind: candidate.kind };
			const key = stagedRootSelectionKey(rootCandidate.mediaItemId, rootCandidate.kind);
			const bucket = buckets.get(key);
			if (bucket) bucket.push(rootCandidate);
			else buckets.set(key, [rootCandidate]);
		}
	}

	return buckets;
}

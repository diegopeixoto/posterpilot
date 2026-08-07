import { resolveConfig } from '$lib/server/config';
import { db } from '$lib/server/db';
import type { TmdbMediaType } from '$lib/server/types';
import {
	resolveTmdbStrict,
	searchTmdbCandidates,
	verifyTmdbCandidate
} from '$lib/server/tmdb/client';
import {
	ManualMatchError,
	createManualMatchService,
	type ConfirmManualMatchInput,
	type SearchManualMatchInput
} from './manual-match';
import { createManualMatchRepository } from './manual-match-store';

export const manualMatchRepository = createManualMatchRepository(db);

async function liveService(requireTmdb: boolean) {
	const config = await resolveConfig();
	if (requireTmdb && !config.tmdbKey) throw new ManualMatchError('tmdb_not_configured');
	const key = config.tmdbKey;
	const requireKey = () => {
		if (!key) throw new ManualMatchError('tmdb_not_configured');
		return key;
	};
	return createManualMatchService(manualMatchRepository, {
		search: (input) => searchTmdbCandidates(input, requireKey()),
		verify: (tmdbId: string, mediaType: TmdbMediaType, language?: string) =>
			verifyTmdbCandidate(tmdbId, mediaType, requireKey(), language),
		resolve: (guids, expectedMediaType) =>
			resolveTmdbStrict(guids, requireKey(), {
				expectedMediaType,
				forceRefresh: true,
				cacheTtlDays: config.httpCacheTtlDays
			})
	});
}

export async function searchManualTmdb(
	serverInstanceId: string,
	itemId: number,
	input: SearchManualMatchInput
) {
	return (await liveService(true)).search(serverInstanceId, itemId, input);
}

export async function confirmManualTmdbMatch(
	serverInstanceId: string,
	itemId: number,
	input: ConfirmManualMatchInput
) {
	return (await liveService(true)).confirm(serverInstanceId, itemId, input);
}

export async function clearManualTmdbMatch(serverInstanceId: string, itemId: number) {
	return (await liveService(false)).clear(serverInstanceId, itemId);
}

export async function listTmdbResolutionAudit(serverInstanceId: string, itemId: number) {
	return (await liveService(false)).audit(serverInstanceId, itemId);
}

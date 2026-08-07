import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { serializeWrite } from '$lib/server/db/write-queue';
import { posterCandidates } from '$lib/server/db/schema';
import { requireScopedMediaItemsById } from '$lib/server/media-items/scoped-query';
import { resolveConfig } from '$lib/server/config';
import { discoverForItem } from '$lib/server/posters/service';
import { PROVIDERS } from '$lib/server/posters/providers';
import { providerAvailability } from '$lib/server/posters/providers/availability';
import { scorePoster } from '$lib/server/posters/score';
import { getScoreWeights } from '$lib/server/posters/score-weights';
import { getCollection } from '$lib/server/collections/queries';
import { fetchThePosterDbCollectionSet } from '$lib/server/collections/theposterdb-collection';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { logEvent } from '$lib/server/events';

const KNOWN_PROVIDER_IDS: Set<string> = new Set(PROVIDERS.map((p) => p.id));

/**
 * Force artwork re-discovery across every local member of a collection. The optional
 * `providers` body field scopes the run to a subset of providers; when absent, every
 * enabled provider participates (the same scope a normal per-item discovery uses).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'server instance not found');

	const collection = await getCollection(active.id, params.id);
	if (!collection) throw error(404, 'collection not found');

	const body = (await request.json().catch(() => ({}))) as {
		forceRefresh?: boolean;
		providers?: string[];
	};
	const providers = Array.isArray(body.providers)
		? body.providers.filter((p): p is string => KNOWN_PROVIDER_IDS.has(p))
		: undefined;

	const memberIds = collection.localMembers.map((member) => member.id);
	const items = memberIds.length ? await requireScopedMediaItemsById(db, active.id, memberIds) : [];

	const config = await resolveConfig();
	let succeeded = 0;
	let failed = 0;
	for (const item of items) {
		try {
			await discoverForItem(item, config, {
				forceRefresh: body.forceRefresh,
				providers
			});
			succeeded++;
		} catch (err) {
			// Skip a member that fails discovery; the rest continue — mirrors the
			// per-item try/catch used by the scheduled discovery job.
			failed++;
			await logEvent('warn', 'discover', `Collection discovery failed for "${item.title}"`, {
				title: item.title,
				serverInstanceId: active.id,
				mediaItemId: item.id,
				collectionId: params.id,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// ThePosterDB collection-set pass: per-member discovery above only title-searches each
	// film independently, which rarely forms one shared "visual family". ThePosterDB's own
	// collection set already IS one coordinated poster-per-film design, so fetch it once and
	// inject each matched poster as a member candidate keyed by the real set id — the
	// existing exact_set family engine then surfaces it across every matched member. Runs
	// only when ThePosterDB is in scope and available; any failure is logged, never fatal.
	const thePosterDbInScope = !providers || providers.includes('theposterdb');
	if (thePosterDbInScope && providerAvailability('theposterdb', config) === 'available') {
		try {
			const set = await fetchThePosterDbCollectionSet(
				collection.name,
				items.map((item) => ({ mediaItemId: item.id, title: item.title, year: item.year })),
				config
			);
			if (!set) {
				await logEvent(
					'info',
					'discover',
					`ThePosterDB collection set: no match for "${collection.name}"`,
					{
						collectionId: params.id,
						serverInstanceId: active.id
					}
				);
			} else if (set.matches.length) {
				const weights = await getScoreWeights();
				const score = scorePoster(
					{ provider: 'theposterdb', width: null, height: null, kind: 'poster' },
					weights
				);
				const now = new Date();
				const byId = new Map(items.map((item) => [item.id, item]));
				// Like every other discovery write, the injection goes through the write
				// queue so it cannot contend with a concurrent per-member discovery.
				await serializeWrite(() =>
					db.insert(posterCandidates).values(
						set.matches.map((match) => {
							const item = byId.get(match.mediaItemId)!;
							return {
								serverInstanceId: active.id,
								mediaItemId: match.mediaItemId,
								setId: `theposterdb-set-${set.setId}`,
								provider: 'theposterdb',
								providerAssetId: match.posterId,
								setAuthor: null,
								language: null,
								languageProvenance: 'unknown' as const,
								url: match.url,
								previewUrl: null,
								kind: 'poster' as const,
								resolvedTmdbId: item.tmdbId,
								resolvedMediaType: item.mediaType,
								score,
								active: true,
								stale: false,
								lastSeenAt: now
							};
						})
					)
				);
				await logEvent(
					'info',
					'discover',
					`ThePosterDB collection set matched ${set.matches.length}/${items.length} members for "${collection.name}"`,
					{ collectionId: params.id, serverInstanceId: active.id, setId: set.setId }
				);
			} else {
				await logEvent(
					'info',
					'discover',
					`ThePosterDB collection set for "${collection.name}" matched no members (set ${set.setId})`,
					{ collectionId: params.id, serverInstanceId: active.id, setId: set.setId }
				);
			}
		} catch (err) {
			await logEvent(
				'warn',
				'discover',
				`ThePosterDB collection set failed for "${collection.name}"`,
				{
					collectionId: params.id,
					serverInstanceId: active.id,
					error: err instanceof Error ? err.message : String(err)
				}
			);
		}
	}

	return json({ total: items.length, succeeded, failed });
};

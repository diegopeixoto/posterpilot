import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	appliedPosters,
	mediaItems,
	posterCandidates,
	type MediaItem
} from '$lib/server/db/schema';
import { requireConfig, type AppConfig, type ApplyMethod } from '$lib/server/config';
import { setPosterLock, uploadPosterBytes, uploadPosterFromUrl } from '$lib/server/plex/client';
import { writeKometaYaml } from '$lib/server/kometa/yaml';
import { availableProviders, PROVIDER_ORDER, type ProviderId } from './providers';

/**
 * Discover artwork candidates for an item across all enabled providers and persist
 * them (replacing any prior candidates), tagging each with its provider. A provider
 * that fails is skipped so the others still contribute. Returns the candidate count.
 */
export async function discoverForItem(
	item: MediaItem,
	config: AppConfig,
	opts?: { forceRefresh?: boolean }
): Promise<number> {
	const providers = availableProviders(config);
	const settled = await Promise.allSettled(
		providers.map((p) =>
			p
				.discover(item, config, { forceRefresh: opts?.forceRefresh })
				.then((sets) => ({ provider: p.id, sets }))
		)
	);

	const rows = settled
		.filter(
			(
				r
			): r is PromiseFulfilledResult<{
				provider: ProviderId;
				sets: Awaited<ReturnType<(typeof providers)[number]['discover']>>;
			}> => r.status === 'fulfilled'
		)
		.flatMap((r) =>
			r.value.sets.flatMap((set) =>
				set.candidates.map((c) => ({
					mediaItemId: item.id,
					provider: r.value.provider,
					setId: c.setId,
					setAuthor: c.setAuthor,
					url: c.url,
					kind: c.kind,
					season: c.season,
					episode: c.episode
				}))
			)
		);

	await db.delete(posterCandidates).where(eq(posterCandidates.mediaItemId, item.id));
	if (rows.length) await db.insert(posterCandidates).values(rows);
	await db
		.update(mediaItems)
		.set({ hasMediux: rows.length > 0, updatedAt: new Date() })
		.where(eq(mediaItems.id, item.id));

	return rows.length;
}

/**
 * Auto-select a primary poster across providers: the first poster candidate from the
 * most-preferred available provider (by PROVIDER_ORDER), then earliest insertion.
 */
export async function autoSelectPoster(itemId: number): Promise<string | null> {
	const rows = await db
		.select()
		.from(posterCandidates)
		.where(and(eq(posterCandidates.mediaItemId, itemId), eq(posterCandidates.kind, 'poster')))
		.orderBy(asc(posterCandidates.id));
	if (!rows.length) return null;
	const rank = (p: string) => {
		const i = PROVIDER_ORDER.indexOf(p as ProviderId);
		return i < 0 ? PROVIDER_ORDER.length : i;
	};
	// Stable sort keeps insertion order within a provider.
	const sorted = [...rows].sort((a, b) => rank(a.provider) - rank(b.provider));
	return sorted[0].url;
}

/** Record a user's pending cover selection for an item. */
export async function selectCandidate(
	itemId: number,
	posterUrl: string | null,
	backgroundUrl?: string | null
): Promise<void> {
	await db
		.update(mediaItems)
		.set({
			selectedPosterUrl: posterUrl,
			selectedBackgroundUrl: backgroundUrl ?? null,
			updatedAt: new Date()
		})
		.where(eq(mediaItems.id, itemId));
}

export interface ApplyOutcome {
	method: 'plex' | 'kometa';
	status: 'success' | 'failed';
	error?: string;
}

/**
 * Apply a cover to an item via the chosen method(s). Each method runs and is
 * recorded independently so a partial failure is visible.
 */
export async function applyToItem(
	item: MediaItem,
	params: {
		posterUrl: string;
		backgroundUrl?: string | null;
		method: ApplyMethod;
		config: AppConfig;
	}
): Promise<ApplyOutcome[]> {
	const { posterUrl, backgroundUrl, method, config } = params;
	const outcomes: ApplyOutcome[] = [];
	const doPlex = method === 'plex' || method === 'both';
	const doKometa = method === 'kometa' || method === 'both';

	if (doPlex) {
		let outcome: ApplyOutcome = { method: 'plex', status: 'success' };
		try {
			requireConfig(config, ['plexUrl', 'plexToken']);
			await uploadPosterFromUrl(config.plexUrl!, config.plexToken!, item.ratingKey, posterUrl);
		} catch (e) {
			outcome = { method: 'plex', status: 'failed', error: errorMessage(e) };
		}
		await db.insert(appliedPosters).values({
			mediaItemId: item.id,
			url: posterUrl,
			method: 'plex',
			status: outcome.status,
			error: outcome.error ?? null
		});
		outcomes.push(outcome);
	}

	if (doKometa) {
		let outcome: ApplyOutcome = { method: 'kometa', status: 'success' };
		try {
			if (!item.tmdbId) throw new Error('Cannot export to Kometa without a TMDB id');
			await writeKometaYaml(config.kometaAssetsDir, [
				{ tmdbId: item.tmdbId, title: item.title, posterUrl, backgroundUrl }
			]);
		} catch (e) {
			outcome = { method: 'kometa', status: 'failed', error: errorMessage(e) };
		}
		await db.insert(appliedPosters).values({
			mediaItemId: item.id,
			url: posterUrl,
			method: 'kometa',
			status: outcome.status,
			error: outcome.error ?? null
		});
		outcomes.push(outcome);
	}

	return outcomes;
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/**
 * Apply a user-supplied image file as the item's poster, directly to Plex (no
 * hosting). Records the application. For a custom URL (which both Plex and Kometa
 * can consume) use the normal apply flow with the URL as the poster instead.
 */
export async function applyCustomUpload(
	item: MediaItem,
	data: ArrayBuffer,
	contentType: string,
	config: AppConfig
): Promise<void> {
	requireConfig(config, ['plexUrl', 'plexToken']);
	await uploadPosterBytes(config.plexUrl!, config.plexToken!, item.ratingKey, data, contentType);
	await db.insert(appliedPosters).values({
		mediaItemId: item.id,
		url: 'custom-upload',
		method: 'plex',
		status: 'success'
	});
}

/**
 * Revert an item to its original Plex poster: re-set the poster captured at sync,
 * unlock the field so Plex manages it again, and clear posterpilot's applied
 * history + pending selection so the item reads as unchanged. The Kometa YAML
 * export (if any) is left in place — remove it from your Kometa config to fully
 * undo a Kometa apply.
 */
export async function revertItem(item: MediaItem, config: AppConfig): Promise<void> {
	requireConfig(config, ['plexUrl', 'plexToken']);
	if (item.currentPosterUrl) {
		await uploadPosterFromUrl(
			config.plexUrl!,
			config.plexToken!,
			item.ratingKey,
			item.currentPosterUrl
		);
	}
	await setPosterLock(config.plexUrl!, config.plexToken!, item.ratingKey, false);
	await db.delete(appliedPosters).where(eq(appliedPosters.mediaItemId, item.id));
	await db
		.update(mediaItems)
		.set({ selectedPosterUrl: null, selectedBackgroundUrl: null, updatedAt: new Date() })
		.where(eq(mediaItems.id, item.id));
}

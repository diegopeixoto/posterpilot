import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { appliedPosters, mediaItems, posterCandidates, type MediaItem } from '$lib/server/db/schema';
import { requireConfig, type AppConfig, type ApplyMethod } from '$lib/server/config';
import { setPosterLock, uploadPosterFromUrl } from '$lib/server/plex/client';
import { writeKometaYaml } from '$lib/server/kometa/yaml';
import { discoverCandidates } from '$lib/server/mediux/scraper';

/**
 * Discover MediaUX candidates for an item and persist them (replacing any prior
 * candidates), then flag whether the item has MediaUX artwork. Returns the count.
 */
export async function discoverForItem(
	item: MediaItem,
	config: AppConfig,
	opts?: { forceRefresh?: boolean }
): Promise<number> {
	if (!item.tmdbId || !item.mediaType) return 0;

	const sets = await discoverCandidates(item.tmdbId, item.mediaType, {
		delayMs: config.mediuxDelayMs,
		concurrency: config.mediuxConcurrency,
		cacheTtlDays: config.httpCacheTtlDays,
		forceRefresh: opts?.forceRefresh
	});
	const flat = sets.flatMap((s) => s.candidates);

	await db.delete(posterCandidates).where(eq(posterCandidates.mediaItemId, item.id));
	if (flat.length) {
		await db.insert(posterCandidates).values(
			flat.map((c) => ({
				mediaItemId: item.id,
				setId: c.setId,
				url: c.url,
				kind: c.kind,
				season: c.season,
				episode: c.episode
			}))
		);
	}
	await db
		.update(mediaItems)
		.set({ hasMediux: flat.length > 0, updatedAt: new Date() })
		.where(eq(mediaItems.id, item.id));

	return flat.length;
}

/** The newest set's primary poster: the first 'poster' candidate in insertion order. */
export async function autoSelectPoster(itemId: number): Promise<string | null> {
	const rows = await db
		.select()
		.from(posterCandidates)
		.where(and(eq(posterCandidates.mediaItemId, itemId), eq(posterCandidates.kind, 'poster')))
		.orderBy(asc(posterCandidates.id))
		.limit(1);
	return rows[0]?.url ?? null;
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
 * Revert an item to its original Plex poster: re-set the poster captured at sync,
 * unlock the field so Plex manages it again, and clear posterpilot's applied
 * history + pending selection so the item reads as unchanged. The Kometa YAML
 * export (if any) is left in place — remove it from your Kometa config to fully
 * undo a Kometa apply.
 */
export async function revertItem(item: MediaItem, config: AppConfig): Promise<void> {
	requireConfig(config, ['plexUrl', 'plexToken']);
	if (item.currentPosterUrl) {
		await uploadPosterFromUrl(config.plexUrl!, config.plexToken!, item.ratingKey, item.currentPosterUrl);
	}
	await setPosterLock(config.plexUrl!, config.plexToken!, item.ratingKey, false);
	await db.delete(appliedPosters).where(eq(appliedPosters.mediaItemId, item.id));
	await db
		.update(mediaItems)
		.set({ selectedPosterUrl: null, selectedBackgroundUrl: null, updatedAt: new Date() })
		.where(eq(mediaItems.id, item.id));
}

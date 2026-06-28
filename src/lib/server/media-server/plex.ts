/**
 * Plex provider — adapts the existing `src/lib/server/plex/client.ts` free
 * functions to the `MediaServer` interface.
 *
 * PRAGMATIC DEVIATION from the original plan (tasks 2.1): the Plex `client.ts`
 * and `parse.ts` files are NOT physically moved under `media-server/plex/`. The
 * existing, tested code is wrapped in place to limit churn/risk — every existing
 * import of `$lib/server/plex/*` keeps working, and the Plex path behaves exactly
 * as before. The provider only re-expresses Plex's quirks (token in query string,
 * `thumb.locked`/`art.locked`) behind the neutral interface. See design.md
 * Open Questions for the rationale.
 */

import {
	testConnection as plexTestConnection,
	listSections,
	listItems,
	listChildren,
	uploadPosterFromUrl,
	uploadPosterBytes,
	setPosterLock,
	uploadBackgroundFromUrl,
	uploadBackgroundBytes,
	setBackgroundLock
} from '$lib/server/plex/client';
import type {
	ConnectionResult,
	LockField,
	MediaServer,
	ServerChild,
	ServerItem,
	ServerLibrary
} from './types';

/** Map Plex children to neutral `ServerChild`, dropping any without a numeric index. */
function toChildren(rows: { ratingKey: string; index: number | null }[]): ServerChild[] {
	const out: ServerChild[] = [];
	for (const r of rows) {
		if (r.index !== null) out.push({ id: r.ratingKey, number: r.index });
	}
	return out;
}

/**
 * Construct a Plex `MediaServer` bound to a base URL + token. All calls delegate
 * to the unchanged `plex/client.ts` functions.
 */
export function plexProvider(baseUrl: string, token: string): MediaServer {
	return {
		type: 'plex',

		async testConnection(): Promise<ConnectionResult> {
			const res = await plexTestConnection(baseUrl, token);
			// Surface the unauthorized flag from the Plex client's 401 message.
			const unauthorized = !res.ok && /401|unauthorized/i.test(res.error ?? '');
			return { ...res, unauthorized: unauthorized || undefined };
		},

		async listLibraries(): Promise<ServerLibrary[]> {
			const sections = await listSections(baseUrl, token);
			return sections.map((s) => ({ key: s.key, title: s.title, type: s.type }));
		},

		async listItems(libraryKey: string): Promise<ServerItem[]> {
			const items = await listItems(baseUrl, token, libraryKey);
			return items.map((i) => ({
				id: i.ratingKey,
				title: i.title,
				year: i.year,
				type: i.type,
				guids: i.guids,
				currentPosterUrl: i.currentPosterUrl,
				// Plex backgrounds are not surfaced by listItems today; left null so the
				// app's TMDB-derived backdrop drives backgrounds, as it does now.
				currentBackgroundUrl: null,
				serverUpdatedAt: i.serverUpdatedAt
			}));
		},

		async listSeasons(showId: string): Promise<ServerChild[]> {
			return toChildren(await listChildren(baseUrl, token, showId));
		},

		async listEpisodes(seasonId: string): Promise<ServerChild[]> {
			return toChildren(await listChildren(baseUrl, token, seasonId));
		},

		async applyPosterUrl(itemId: string, url: string): Promise<void> {
			await uploadPosterFromUrl(baseUrl, token, itemId, url);
		},

		async applyPosterBytes(itemId, data, contentType): Promise<void> {
			await uploadPosterBytes(baseUrl, token, itemId, data, contentType);
		},

		async applyBackgroundUrl(itemId: string, url: string): Promise<void> {
			await uploadBackgroundFromUrl(baseUrl, token, itemId, url);
		},

		async applyBackgroundBytes(itemId, data, contentType): Promise<void> {
			await uploadBackgroundBytes(baseUrl, token, itemId, data, contentType);
		},

		async lockField(itemId: string, field: LockField, locked: boolean): Promise<void> {
			if (field === 'poster') {
				await setPosterLock(baseUrl, token, itemId, locked);
			} else {
				await setBackgroundLock(baseUrl, token, itemId, locked);
			}
		}
	};
}

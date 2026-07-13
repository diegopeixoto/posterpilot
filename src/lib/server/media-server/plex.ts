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
	listCollections,
	listChildren,
	uploadPosterFromUrl,
	uploadPosterBytes,
	setPosterLock,
	uploadBackgroundFromUrl,
	uploadBackgroundBytes,
	setBackgroundLock,
	readArtwork as readPlexArtwork,
	type PlexChild
} from '$lib/server/plex/client';
import { defaultMediaServerCapabilities, mediaServerIdentity } from './capabilities';
import type {
	ConnectionResult,
	LockField,
	MediaServer,
	ServerChild,
	ServerItem,
	ServerLibrary,
	ServerNativeCollection
} from './types';

/** Map Plex children to neutral `ServerChild`, dropping any without a numeric index. */
function toChildren(rows: PlexChild[]): ServerChild[] {
	const out: ServerChild[] = [];
	for (const r of rows) {
		if (r.index !== null) {
			out.push({
				id: r.ratingKey,
				number: r.index,
				currentPosterUrl: r.currentPosterUrl,
				currentBackgroundUrl: r.currentBackgroundUrl,
				serverUpdatedAt: r.serverUpdatedAt
			});
		}
	}
	return out;
}

/**
 * Construct a Plex `MediaServer` bound to a base URL + token. All calls delegate
 * to the unchanged `plex/client.ts` functions.
 */
export function plexProvider(
	baseUrl: string,
	token: string,
	context: Pick<MediaServer, 'identity' | 'capabilities'> = {
		identity: mediaServerIdentity('plex'),
		capabilities: defaultMediaServerCapabilities('plex')
	}
): MediaServer {
	return {
		type: 'plex',
		identity: context.identity,
		capabilities: context.capabilities,

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
				currentBackgroundUrl: i.currentBackgroundUrl,
				serverUpdatedAt: i.serverUpdatedAt,
				addedAt: i.addedAt,
				watched: i.watched
			}));
		},

		async listNativeCollections(libraryKeys: string[]): Promise<ServerNativeCollection[]> {
			return (await listCollections(baseUrl, token, libraryKeys)).map((collection) => ({
				id: collection.ratingKey,
				name: collection.title,
				members: collection.members.map((member) => ({
					id: member.ratingKey,
					title: member.title,
					year: member.year
				})),
				currentPosterUrl: collection.currentPosterUrl,
				currentBackgroundUrl: collection.currentBackgroundUrl,
				libraryKeys: collection.libraryKeys,
				capabilities: {
					posterWrite: context.capabilities.collectionArtwork ?? 'supported',
					backgroundWrite: context.capabilities.collectionArtwork ?? 'supported'
				}
			}));
		},

		async applyCollectionPosterUrl(collectionId: string, url: string): Promise<void> {
			await uploadPosterFromUrl(baseUrl, token, collectionId, url);
		},

		async applyCollectionPosterBytes(collectionId, data, contentType): Promise<void> {
			await uploadPosterBytes(baseUrl, token, collectionId, data, contentType);
		},

		async applyCollectionBackgroundUrl(collectionId: string, url: string): Promise<void> {
			await uploadBackgroundFromUrl(baseUrl, token, collectionId, url);
		},

		async applyCollectionBackgroundBytes(collectionId, data, contentType): Promise<void> {
			await uploadBackgroundBytes(baseUrl, token, collectionId, data, contentType);
		},

		async readCollectionArtwork(collectionId, kind) {
			const artwork = await readPlexArtwork(baseUrl, token, collectionId, kind);
			return artwork ? { kind, ...artwork } : null;
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

		async readArtwork(itemId, kind) {
			const artwork = await readPlexArtwork(baseUrl, token, itemId, kind);
			return artwork ? { kind, ...artwork } : null;
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

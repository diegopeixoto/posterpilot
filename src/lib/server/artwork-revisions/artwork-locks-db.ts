import { db as liveDb } from '$lib/server/db';
import { resolveConfig } from '$lib/server/config';
import { logEvent } from '$lib/server/events';
import type { MediaServer } from '$lib/server/media-server';
import { createArtworkLockManager, type ArtworkLockManager } from './artwork-locks';
import { createDatabaseArtworkLockStore, type Database } from './artwork-locks-store';

/**
 * Plex locks one field at a time and always has; Jellyfin/Emby only lock the
 * whole item, which also freezes its metadata, so they lock only when the
 * person opted in.
 */
async function lockingEnabled(server: MediaServer): Promise<boolean> {
	if (server.type === 'plex') return true;
	return (await resolveConfig()).jellyfinItemLock;
}

/** The lock manager the live apply, upload and undo runtimes share. */
export function createLiveArtworkLockManager(database: Database = liveDb): ArtworkLockManager {
	return createArtworkLockManager({
		store: createDatabaseArtworkLockStore(database),
		lockingEnabled,
		warn: (message, context) => void logEvent('warn', 'apply', message, context)
	});
}

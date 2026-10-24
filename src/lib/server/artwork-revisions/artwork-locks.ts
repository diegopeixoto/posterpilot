/**
 * Apply-time artwork locks: take one after a successful write, release it after
 * a successful undo, and never let either step fail the artwork change itself.
 *
 * The bytes are already on the server when these run, so a lock that cannot be
 * set (or released) is reported as a warning rather than turned into a failed
 * apply or undo — the ledger has to keep describing what the server actually
 * serves.
 *
 * Ownership is what keeps this safe on servers whose lock covers the whole item
 * (Jellyfin/Emby `LockData`):
 *
 * - A lock already in place before PosterPilot touched the item is the person's
 *   own. It is left alone and never recorded, so undo can never clear it.
 * - Each slot PosterPilot locked is recorded. Undoing one slot releases the
 *   item-level lock only once no other recorded slot remains on that target, so
 *   undoing the poster never unprotects a backdrop PosterPilot still owns.
 *
 * Kept free of the database and `$env` so it is unit-testable; the store and the
 * opt-in policy are injected.
 */
import type { MediaServer, ServerArtworkKind } from '$lib/server/media-server';

/** One locked artwork slot on one server target. */
export interface ArtworkLockKey {
	serverInstanceId: string;
	targetId: string;
	kind: ServerArtworkKind;
}

/** Durable record of the locks PosterPilot itself took. */
export interface ArtworkLockStore {
	has(key: ArtworkLockKey): Promise<boolean>;
	add(key: ArtworkLockKey): Promise<void>;
	remove(key: ArtworkLockKey): Promise<void>;
	/** How many slots PosterPilot still holds locked on one target. */
	countForTarget(serverInstanceId: string, targetId: string): Promise<number>;
}

export interface ArtworkLockManager {
	/** Lock a slot after its artwork was written. Never throws. */
	afterApply(server: MediaServer, key: ArtworkLockKey): Promise<void>;
	/** Release a slot's lock after its artwork was restored. Never throws. */
	afterRestore(server: MediaServer, key: ArtworkLockKey): Promise<void>;
}

export interface ArtworkLockManagerDependencies {
	store: ArtworkLockStore;
	/**
	 * Whether applies on this server take locks at all. Releasing is not gated:
	 * a lock PosterPilot recorded is released on undo even after locking was
	 * switched off, so turning the setting off never strands a frozen item.
	 */
	lockingEnabled(server: MediaServer): boolean | Promise<boolean>;
	warn?(message: string, context: Record<string, unknown>): void;
}

/** The server's one lock covers every field of the item, not a single slot. */
export function locksWholeItem(server: Pick<MediaServer, 'capabilities'>): boolean {
	return server.capabilities?.limitations?.includes('field_lock_item_level') ?? false;
}

export function createArtworkLockManager(
	dependencies: ArtworkLockManagerDependencies
): ArtworkLockManager {
	const { store } = dependencies;
	const warn = (message: string, key: ArtworkLockKey, error: unknown) =>
		dependencies.warn?.(message, {
			serverInstanceId: key.serverInstanceId,
			targetId: key.targetId,
			kind: key.kind,
			error: error instanceof Error ? error.message : String(error)
		});

	/** A lock is already on, and nothing PosterPilot recorded explains it. */
	async function lockedByPerson(server: MediaServer, key: ArtworkLockKey): Promise<boolean> {
		if (!server.readFieldLock) return false;
		if (await store.has(key)) return false;
		// On an item-level lock, another slot PosterPilot holds explains it.
		const heldOnTarget = locksWholeItem(server)
			? await store.countForTarget(key.serverInstanceId, key.targetId)
			: 0;
		if (heldOnTarget > 0) return false;
		return (await server.readFieldLock(key.targetId, key.kind)) === true;
	}

	return {
		async afterApply(server, key) {
			if (server.capabilities?.fieldLock !== 'supported' || !server.lockField) return;
			try {
				if (!(await dependencies.lockingEnabled(server))) return;
				if (await lockedByPerson(server, key)) return;
				// Recorded before the server call: a crash between the two leaves a
				// record for a lock that may not exist, and releasing a lock that is
				// not there is harmless — unlike a real lock nobody recorded.
				const known = await store.has(key);
				if (!known) await store.add(key);
				try {
					await server.lockField(key.targetId, key.kind, true);
				} catch (error) {
					if (!known) await store.remove(key);
					throw error;
				}
			} catch (error) {
				warn('Applied artwork could not be locked on the media server', key, error);
			}
		},

		async afterRestore(server, key) {
			if (!server.lockField) return;
			try {
				if (!(await store.has(key))) return;
				const othersHeld =
					locksWholeItem(server) &&
					(await store.countForTarget(key.serverInstanceId, key.targetId)) > 1;
				// Released before the record goes, so a failed unlock keeps the record
				// and a later undo can still release the lock.
				if (!othersHeld) await server.lockField(key.targetId, key.kind, false);
				await store.remove(key);
			} catch (error) {
				warn('Restored artwork could not be unlocked on the media server', key, error);
			}
		}
	};
}

/** In-memory store for tests and other database-free callers. */
export function createMemoryArtworkLockStore(): ArtworkLockStore & { keys(): ArtworkLockKey[] } {
	const held = new Map<string, ArtworkLockKey>();
	const id = (key: ArtworkLockKey) =>
		JSON.stringify([key.serverInstanceId, key.targetId, key.kind]);
	return {
		async has(key) {
			return held.has(id(key));
		},
		async add(key) {
			held.set(id(key), { ...key });
		},
		async remove(key) {
			held.delete(id(key));
		},
		async countForTarget(serverInstanceId, targetId) {
			return [...held.values()].filter(
				(key) => key.serverInstanceId === serverInstanceId && key.targetId === targetId
			).length;
		},
		keys: () => [...held.values()]
	};
}

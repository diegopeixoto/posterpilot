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
 * - A lock already in place before PosterPilot wrote the artwork is the person's
 *   own. It is read before the write (Plex locks the field as part of the upload,
 *   so afterwards every slot looks locked), left alone and never recorded, so
 *   undo can never clear it. A lock state that cannot be read is treated the
 *   same way: PosterPilot only claims a lock it knows it took.
 * - Each apply PosterPilot locked holds the slot once. Undoing an apply drops one
 *   hold, so undoing a replacement keeps the earlier applied artwork it restores
 *   protected; the lock goes only with the slot's last hold.
 * - On an item-level lock, the item is released only once no other recorded slot
 *   remains on that target, so undoing the poster never unprotects a backdrop
 *   PosterPilot still owns.
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
	/** How many applies still hold this slot locked (0 when PosterPilot holds none). */
	holds(key: ArtworkLockKey): Promise<number>;
	/** Add one hold on the slot. */
	add(key: ArtworkLockKey): Promise<void>;
	/** Drop one hold on the slot, forgetting it with its last hold. */
	release(key: ArtworkLockKey): Promise<void>;
	/** How many slots PosterPilot still holds locked on one target. */
	countForTarget(serverInstanceId: string, targetId: string): Promise<number>;
}

/** What the slot's lock looked like before the write, from {@link ArtworkLockManager.beforeApply}. */
export interface ArtworkLockClaim {
	/** The slot was unlocked, or locked only by PosterPilot, so the lock may be claimed. */
	readonly ours: boolean;
}

export interface ArtworkLockManager {
	/** Read the slot's lock before its artwork is written. Never throws. */
	beforeApply(server: MediaServer, key: ArtworkLockKey): Promise<ArtworkLockClaim>;
	/** Lock a slot after its artwork was written. Never throws. */
	afterApply(server: MediaServer, key: ArtworkLockKey, claim: ArtworkLockClaim): Promise<void>;
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

	const takesLocks = (server: MediaServer) =>
		server.capabilities?.fieldLock === 'supported' && !!server.lockField;

	return {
		async beforeApply(server, key) {
			if (!takesLocks(server)) return { ours: false };
			try {
				if (!(await dependencies.lockingEnabled(server))) return { ours: false };
				if ((await store.holds(key)) > 0) return { ours: true };
				// On an item-level lock, another slot PosterPilot holds explains it.
				if (
					locksWholeItem(server) &&
					(await store.countForTarget(key.serverInstanceId, key.targetId)) > 0
				) {
					return { ours: true };
				}
				// Unknown is not ours: claiming it could let undo clear the person's lock.
				if (!server.readFieldLock) return { ours: false };
				return { ours: (await server.readFieldLock(key.targetId, key.kind)) === false };
			} catch (error) {
				warn('Artwork lock state could not be read from the media server', key, error);
				return { ours: false };
			}
		},

		async afterApply(server, key, claim) {
			if (!claim.ours || !takesLocks(server)) return;
			try {
				// Recorded before the server call: a crash between the two leaves a
				// record for a lock that may not exist, and releasing a lock that is
				// not there is harmless — unlike a real lock nobody recorded.
				await store.add(key);
				try {
					await server.lockField!(key.targetId, key.kind, true);
				} catch (error) {
					await store.release(key);
					throw error;
				}
			} catch (error) {
				warn('Applied artwork could not be locked on the media server', key, error);
			}
		},

		async afterRestore(server, key) {
			if (!server.lockField) return;
			try {
				const holds = await store.holds(key);
				if (holds === 0) return;
				// An earlier PosterPilot apply is what the undo restored: keep it locked.
				if (holds > 1) return await store.release(key);
				const othersHeld =
					locksWholeItem(server) &&
					(await store.countForTarget(key.serverInstanceId, key.targetId)) > 1;
				// Released before the record goes, so a failed unlock keeps the record
				// and a later undo can still release the lock.
				if (!othersHeld) await server.lockField(key.targetId, key.kind, false);
				await store.release(key);
			} catch (error) {
				warn('Restored artwork could not be unlocked on the media server', key, error);
			}
		}
	};
}

/** In-memory store for tests and other database-free callers. */
export function createMemoryArtworkLockStore(): ArtworkLockStore & { keys(): ArtworkLockKey[] } {
	const held = new Map<string, { key: ArtworkLockKey; holds: number }>();
	const id = (key: ArtworkLockKey) =>
		JSON.stringify([key.serverInstanceId, key.targetId, key.kind]);
	return {
		async holds(key) {
			return held.get(id(key))?.holds ?? 0;
		},
		async add(key) {
			const entry = held.get(id(key));
			held.set(id(key), { key: { ...key }, holds: (entry?.holds ?? 0) + 1 });
		},
		async release(key) {
			const entry = held.get(id(key));
			if (!entry) return;
			if (entry.holds > 1) entry.holds -= 1;
			else held.delete(id(key));
		},
		async countForTarget(serverInstanceId, targetId) {
			return [...held.values()].filter(
				({ key }) => key.serverInstanceId === serverInstanceId && key.targetId === targetId
			).length;
		},
		keys: () => [...held.values()].map(({ key }) => key)
	};
}

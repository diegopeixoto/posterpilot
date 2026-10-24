import { describe, expect, it, vi } from 'vitest';
import type { MediaServer } from '$lib/server/media-server';
import {
	createArtworkLockManager,
	createMemoryArtworkLockStore,
	locksWholeItem,
	type ArtworkLockKey
} from './artwork-locks';

const POSTER: ArtworkLockKey = { serverInstanceId: 'server-1', targetId: 'item-1', kind: 'poster' };
const BACKDROP: ArtworkLockKey = { ...POSTER, kind: 'background' };

/** A server whose lock covers the whole item, like Jellyfin's `LockData`. */
function itemLevelServer(initiallyLocked = false) {
	let locked = initiallyLocked;
	const lockField = vi.fn(async (_id: string, _field: string, next: boolean) => {
		locked = next;
	});
	const server = {
		type: 'jellyfin',
		capabilities: { fieldLock: 'supported', limitations: ['field_lock_item_level'] },
		lockField,
		readFieldLock: vi.fn(async () => locked)
	} as unknown as MediaServer;
	return { server, lockField, isLocked: () => locked };
}

function manager(
	options: {
		enabled?: boolean;
		warn?: (message: string, context: Record<string, unknown>) => void;
	} = {}
) {
	const store = createMemoryArtworkLockStore();
	return {
		store,
		locks: createArtworkLockManager({
			store,
			lockingEnabled: () => options.enabled ?? true,
			warn: options.warn
		})
	};
}

describe('artwork lock manager', () => {
	it('locks after an apply and records that PosterPilot owns the lock', async () => {
		const { server, isLocked } = itemLevelServer();
		const { store, locks } = manager();

		await locks.afterApply(server, POSTER);

		expect(isLocked()).toBe(true);
		expect(store.keys()).toEqual([POSTER]);
	});

	it('takes no lock while the opt-in is off', async () => {
		const { server, lockField } = itemLevelServer();
		const { store, locks } = manager({ enabled: false });

		await locks.afterApply(server, POSTER);

		expect(lockField).not.toHaveBeenCalled();
		expect(store.keys()).toEqual([]);
	});

	it('leaves a lock the person set by hand alone, on apply and on undo', async () => {
		const { server, lockField, isLocked } = itemLevelServer(true);
		const { store, locks } = manager();

		await locks.afterApply(server, POSTER);
		await locks.afterRestore(server, POSTER);

		expect(lockField).not.toHaveBeenCalled();
		expect(store.keys()).toEqual([]);
		expect(isLocked()).toBe(true);
	});

	it('keeps an item-level lock until the last slot PosterPilot holds is undone', async () => {
		const { server, isLocked } = itemLevelServer();
		const { store, locks } = manager();

		await locks.afterApply(server, POSTER);
		// Already locked by PosterPilot's own poster, so this is not the person's lock.
		await locks.afterApply(server, BACKDROP);
		expect(store.keys()).toHaveLength(2);

		await locks.afterRestore(server, POSTER);
		expect(isLocked()).toBe(true);

		await locks.afterRestore(server, BACKDROP);
		expect(isLocked()).toBe(false);
		expect(store.keys()).toEqual([]);
	});

	it('releases a per-field lock on its own slot', async () => {
		const lockField = vi.fn(async () => undefined);
		const server = {
			type: 'plex',
			capabilities: { fieldLock: 'supported', limitations: [] },
			lockField
		} as unknown as MediaServer;
		const { locks } = manager();

		await locks.afterApply(server, POSTER);
		await locks.afterApply(server, BACKDROP);
		await locks.afterRestore(server, POSTER);

		expect(lockField).toHaveBeenLastCalledWith('item-1', 'poster', false);
	});

	it('still releases its own locks after the opt-in is turned off', async () => {
		const { server, isLocked } = itemLevelServer();
		const store = createMemoryArtworkLockStore();
		let enabled = true;
		const locks = createArtworkLockManager({ store, lockingEnabled: () => enabled });

		await locks.afterApply(server, POSTER);
		enabled = false;
		await locks.afterRestore(server, POSTER);

		expect(isLocked()).toBe(false);
	});

	it('never throws, and forgets a lock the server refused', async () => {
		const warn = vi.fn();
		const server = {
			type: 'jellyfin',
			capabilities: { fieldLock: 'supported', limitations: ['field_lock_item_level'] },
			lockField: vi.fn(async () => {
				throw new Error('HTTP 403');
			}),
			readFieldLock: vi.fn(async () => false)
		} as unknown as MediaServer;
		const { store, locks } = manager({ warn });

		await expect(locks.afterApply(server, POSTER)).resolves.toBeUndefined();

		expect(store.keys()).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/could not be locked/),
			expect.objectContaining({ targetId: 'item-1', error: 'HTTP 403' })
		);
	});

	it('keeps the record when an unlock fails so a later undo can retry', async () => {
		const { server, lockField } = itemLevelServer();
		const { store, locks } = manager({ warn: vi.fn() });
		await locks.afterApply(server, POSTER);
		lockField.mockRejectedValueOnce(new Error('HTTP 500'));

		await expect(locks.afterRestore(server, POSTER)).resolves.toBeUndefined();

		expect(store.keys()).toEqual([POSTER]);
	});

	it('skips servers whose contract has no lock', async () => {
		const lockField = vi.fn(async () => undefined);
		const server = {
			type: 'jellyfin',
			capabilities: { fieldLock: 'unsupported', limitations: [] },
			lockField
		} as unknown as MediaServer;
		const { locks } = manager();

		await locks.afterApply(server, POSTER);

		expect(lockField).not.toHaveBeenCalled();
	});

	it('reads item-level locking from the capability limitations', () => {
		expect(locksWholeItem(itemLevelServer().server)).toBe(true);
		expect(
			locksWholeItem({
				capabilities: { limitations: [] } as unknown as MediaServer['capabilities']
			})
		).toBe(false);
	});
});

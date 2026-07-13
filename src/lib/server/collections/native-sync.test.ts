import { describe, expect, it, vi } from 'vitest';
import { reconcileOptionalNativeCollections } from './native-sync';

const collection = {
	id: 'native-1',
	name: 'Collection',
	members: [],
	currentPosterUrl: null,
	currentBackgroundUrl: null,
	libraryKeys: ['library-a'],
	capabilities: { posterWrite: 'supported' as const, backgroundWrite: 'supported' as const }
};

describe('optional native collection sync', () => {
	it('does nothing when the provider does not implement discovery', async () => {
		const reconcile = vi.fn();
		await expect(
			reconcileOptionalNativeCollections({ server: {}, libraryKeys: ['a'], reconcile })
		).resolves.toEqual({ status: 'unsupported', discovered: 0 });
		expect(reconcile).not.toHaveBeenCalled();
	});

	it('does not turn a provider failure into an authoritative empty refresh', async () => {
		const reconcile = vi.fn();
		const listNativeCollections = vi.fn().mockRejectedValue(new Error('private upstream URL'));
		await expect(
			reconcileOptionalNativeCollections({
				server: { listNativeCollections },
				libraryKeys: ['a'],
				reconcile
			})
		).resolves.toEqual({ status: 'failed', discovered: 0 });
		expect(reconcile).not.toHaveBeenCalled();
	});

	it('reconciles an authoritative successful response', async () => {
		const reconcile = vi.fn().mockResolvedValue(undefined);
		const listNativeCollections = vi.fn().mockResolvedValue([collection]);
		await expect(
			reconcileOptionalNativeCollections({
				server: { listNativeCollections },
				libraryKeys: ['a', 'a'],
				reconcile
			})
		).resolves.toEqual({ status: 'succeeded', discovered: 1 });
		expect(listNativeCollections).toHaveBeenCalledWith(['a']);
		expect(reconcile).toHaveBeenCalledWith([collection]);
	});

	it('treats a successful empty response as authoritative', async () => {
		const reconcile = vi.fn().mockResolvedValue(undefined);
		const listNativeCollections = vi.fn().mockResolvedValue([]);
		await expect(
			reconcileOptionalNativeCollections({
				server: { listNativeCollections },
				libraryKeys: ['a'],
				reconcile
			})
		).resolves.toEqual({ status: 'succeeded', discovered: 0 });
		expect(reconcile).toHaveBeenCalledWith([]);
	});

	it('propagates reconciliation failures after successful discovery', async () => {
		const persistenceFailure = new Error('collection_persistence_failed');
		const reconcile = vi.fn().mockRejectedValue(persistenceFailure);
		const listNativeCollections = vi.fn().mockResolvedValue([collection]);

		await expect(
			reconcileOptionalNativeCollections({
				server: { listNativeCollections },
				libraryKeys: ['a'],
				reconcile
			})
		).rejects.toBe(persistenceFailure);
		expect(reconcile).toHaveBeenCalledWith([collection]);
	});
});

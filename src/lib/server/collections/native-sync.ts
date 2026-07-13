import type { MediaServer, ServerNativeCollection } from '$lib/server/media-server';

export type NativeCollectionSyncStatus = 'unsupported' | 'succeeded' | 'failed';

export interface NativeCollectionSyncResult {
	status: NativeCollectionSyncStatus;
	discovered: number;
}

export interface ReconcileOptionalNativeCollectionsInput {
	server: Pick<MediaServer, 'listNativeCollections'>;
	libraryKeys: string[];
	reconcile(collections: ServerNativeCollection[]): Promise<unknown>;
}

/**
 * Optional provider seam: absence or a transient discovery failure never throws
 * into TMDB-backed sync and never runs an authoritative empty reconcile. Once a
 * snapshot was read successfully, persistence failures propagate to the caller.
 */
export async function reconcileOptionalNativeCollections(
	input: ReconcileOptionalNativeCollectionsInput
): Promise<NativeCollectionSyncResult> {
	if (!input.server.listNativeCollections) return { status: 'unsupported', discovered: 0 };
	let collections: ServerNativeCollection[];
	try {
		collections = await input.server.listNativeCollections([...new Set(input.libraryKeys)]);
	} catch {
		return { status: 'failed', discovered: 0 };
	}
	await input.reconcile(collections);
	return { status: 'succeeded', discovered: collections.length };
}

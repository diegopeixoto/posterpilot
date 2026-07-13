import { resolveConfig } from '$lib/server/config';
import { parseLibraryFilter } from '$lib/library-filter';
import { fingerprintLibrarySelection } from '$lib/library-selection';
import { listLibraryIds } from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

export class LibrarySelectionError extends Error {
	constructor(public readonly code: 'invalid_request' | 'no_active_server' | 'result_set_changed') {
		super(code);
		this.name = 'LibrarySelectionError';
	}
}

export async function materializeLibrarySelection(
	query: string,
	expectedFingerprint?: string | null
) {
	if (
		typeof query !== 'string' ||
		query.length > 8_000 ||
		(!query.startsWith('?') && query !== '')
	) {
		throw new LibrarySelectionError('invalid_request');
	}
	const [config, activeServer] = await Promise.all([resolveConfig(), getActiveServerInstance()]);
	if (!activeServer) throw new LibrarySelectionError('no_active_server');
	const filter = parseLibraryFilter(new URLSearchParams(query));
	const effectiveSort = filter.sort ?? config.libraryDefaultSort;
	const orderedItemIds = await listLibraryIds({
		...filter,
		serverInstanceId: activeServer.id,
		sort: effectiveSort
	});
	const fingerprint = fingerprintLibrarySelection({
		serverInstanceId: activeServer.id,
		filter,
		effectiveSort,
		orderedItemIds
	});
	if (expectedFingerprint && fingerprint !== expectedFingerprint) {
		throw new LibrarySelectionError('result_set_changed');
	}
	return {
		serverInstanceId: activeServer.id,
		itemIds: orderedItemIds,
		count: orderedItemIds.length,
		fingerprint
	};
}
